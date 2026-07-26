import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { openDatabase } from "../lib/db";
import {
  REALTIME_FLAGSHIP,
  TERRA_MODEL,
  TTS_MODEL,
  TUTOR_STT_MODEL,
  realtimeTurnUsageCost,
  sttCallCost,
  terraUsageCost,
  ttsCostFromAudioSeconds,
  ttsAudioSecondsFromMp3Bytes,
  type RealtimeTurnUsage,
} from "../lib/analysis/rates";
import {
  TUTOR_PRESETS,
  type TutorArchitecture,
  type TutorPromptPreset,
} from "../lib/tutor/experiment";
import { buildMintSessionWireBody } from "../lib/tutor/mint";
import {
  buildSelectedTutorPrompt,
  buildTutorSessionConfig,
} from "../lib/tutor/session-config";
import {
  extractRealtimeUsage,
  extractTextDelta,
  manualTurnEvents,
  parseRealtimeEvent,
  repairResponse,
} from "../lib/tutor/realtime-client";
import { openAiTerraClient, TERRA_REASONING_EFFORT } from "../lib/tutor/terra";
import {
  TutorTurnParseError,
  parseTutorTurnResult,
  type ParsedTutorTurn,
} from "../lib/tutor/turn-result";
import {
  openAiTextToSpeech,
  openAiTutorSpeechToText,
} from "../lib/voice/openai-speech";

const execFileAsync = promisify(execFile);
const HARD_SPEND_USD = 1.5;
const NEXT_CELL_RESERVE_USD = 0.03;
const VOICE = "coral";

interface Fixture {
  id: string;
  text: string;
  expectedCategory: "grammar" | "vocabulary" | null;
}

const FIXTURES: readonly Fixture[] = [
  { id: "G1", text: "Ieri ho andato al cinema con i miei amici.", expectedCategory: "grammar" },
  { id: "G2", text: "Questo è una problema molto importante.", expectedCategory: "vocabulary" },
  { id: "G3", text: "Alla fine ho fatto una decisione difficile.", expectedCategory: "vocabulary" },
  { id: "C1", text: "Ieri sono andato al cinema con i miei amici.", expectedCategory: null },
  { id: "C2", text: "Vorrei sapere se fosse possibile prenotare un tavolo.", expectedCategory: null },
] as const;

interface PreparedFixture extends Fixture {
  mp3: Uint8Array;
  pcm: Uint8Array;
  durationSeconds: number;
  setupTtsUsd: number;
}

interface Cell {
  fixture: string;
  architecture: TutorArchitecture;
  preset: TutorPromptPreset;
  caught: boolean | null;
  missed: boolean | null;
  falseCorrection: boolean | null;
  parseFailure: boolean;
  firstAudioMs: number | null;
  costUsd: number;
  costKind: "usage-derived+modelled" | "modelled";
  errors: string;
  promptHash: string;
}

function key(): string {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("OPENAI_API_KEY is required for the live tutor benchmark.");
  return value;
}

function addUsage(a: RealtimeTurnUsage, b: RealtimeTurnUsage): RealtimeTurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    audioInputTokens: a.audioInputTokens + b.audioInputTokens,
    cachedAudioInputTokens: a.cachedAudioInputTokens + b.cachedAudioInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

const ZERO_USAGE: RealtimeTurnUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  audioInputTokens: 0,
  cachedAudioInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

async function synthesize(text: string): Promise<{
  bytes: Uint8Array;
  firstMs: number;
  costUsd: number;
}> {
  const started = performance.now();
  let firstMs = 0;
  const chunks: Uint8Array[] = [];
  const tts = openAiTextToSpeech(VOICE);
  for await (const chunk of tts.synthesizeStream!({ text, language: "it" })) {
    if (chunks.length === 0) firstMs = performance.now() - started;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  const seconds = ttsAudioSecondsFromMp3Bytes(bytes.byteLength);
  return {
    bytes,
    firstMs,
    costUsd: ttsCostFromAudioSeconds(TTS_MODEL, seconds, text.length),
  };
}

async function prepareFixture(root: string, fixture: Fixture): Promise<PreparedFixture> {
  const spoken = await synthesize(fixture.text);
  const mp3Path = path.join(root, `${fixture.id}.mp3`);
  const pcmPath = path.join(root, `${fixture.id}.pcm`);
  fs.writeFileSync(mp3Path, spoken.bytes);
  await execFileAsync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-i",
    mp3Path,
    "-ac",
    "1",
    "-ar",
    "24000",
    "-f",
    "s16le",
    pcmPath,
  ]);
  const probe = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mp3Path,
  ]);
  return {
    ...fixture,
    mp3: spoken.bytes,
    pcm: new Uint8Array(fs.readFileSync(pcmPath)),
    durationSeconds: Number(probe.stdout.trim()),
    setupTtsUsd: spoken.costUsd,
  };
}

function completedText(event: Record<string, unknown>): string {
  const response = event.response as
    | { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
    | undefined;
  return (
    response?.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

async function nativeTurn(
  wire: Record<string, unknown>,
  audio: Uint8Array,
): Promise<{ parsed: ParsedTutorTurn | null; usage: RealtimeTurnUsage }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_FLAGSHIP)}`,
      { headers: { authorization: `Bearer ${key()}` } },
    );
    let text = "";
    let repairs = 0;
    let usage = { ...ZERO_USAGE };
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Realtime benchmark turn timed out."));
    }, 45_000);
    const finish = (result: ParsedTutorTurn | null) => {
      clearTimeout(timer);
      socket.close();
      resolve({ parsed: result, usage });
    };
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "session.update", session: wire }));
    });
    socket.on("message", (raw) => {
      const event = parseRealtimeEvent(String(raw));
      if (!event) return;
      if (event.type === "session.updated") {
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: Buffer.from(audio).toString("base64"),
          }),
        );
        for (const turnEvent of manualTurnEvents()) socket.send(JSON.stringify(turnEvent));
        return;
      }
      const delta = extractTextDelta(event);
      if (delta) text += delta;
      if (event.type === "error") {
        const error = event.error as { message?: string } | undefined;
        clearTimeout(timer);
        socket.close();
        reject(new Error(error?.message ?? "Realtime benchmark contract error."));
        return;
      }
      if (event.type !== "response.done") return;
      const turnUsage = extractRealtimeUsage(event);
      if (turnUsage) usage = addUsage(usage, turnUsage);
      if (!text) text = completedText(event);
      try {
        finish(parseTutorTurnResult(text, { allowPronunciation: true }));
      } catch (error) {
        if (!(error instanceof TutorTurnParseError)) throw error;
        if (repairs === 0) {
          repairs = 1;
          const invalid = text;
          text = "";
          socket.send(JSON.stringify(repairResponse(invalid)));
        } else {
          finish(null);
        }
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Realtime benchmark WebSocket failed."));
    });
  });
}

function assess(
  fixture: PreparedFixture,
  architecture: TutorArchitecture,
  preset: TutorPromptPreset,
  parsed: ParsedTutorTurn | null,
  firstAudioMs: number | null,
  costUsd: number,
  promptHash: string,
): Cell {
  const errors = parsed?.result.errors ?? [];
  const caught =
    fixture.expectedCategory === null
      ? null
      : errors.some((error) => error.category === fixture.expectedCategory);
  return {
    fixture: fixture.id,
    architecture,
    preset,
    caught,
    missed: caught === null ? null : !caught,
    falseCorrection:
      parsed === null || fixture.expectedCategory !== null ? null : errors.length > 0,
    parseFailure: parsed === null,
    firstAudioMs,
    costUsd,
    costKind: "usage-derived+modelled",
    errors: errors.map((error) => error.category).join(", ") || "none",
    promptHash,
  };
}

async function runNative(
  db: ReturnType<typeof openDatabase>,
  fixture: PreparedFixture,
  preset: TutorPromptPreset,
): Promise<Cell> {
  const built = buildTutorSessionConfig(db, undefined, preset);
  const started = performance.now();
  const result = await nativeTurn(
    buildMintSessionWireBody(built.config) as unknown as Record<string, unknown>,
    fixture.pcm,
  );
  const realtimeUsd = realtimeTurnUsageCost(REALTIME_FLAGSHIP, result.usage).totalUsd;
  if (!result.parsed) {
    return assess(fixture, "native", preset, null, null, realtimeUsd, built.promptHash);
  }
  const speechStarted = performance.now();
  const speech = await synthesize(result.parsed.result.reply);
  return assess(
    fixture,
    "native",
    preset,
    result.parsed,
    speechStarted - started + speech.firstMs,
    realtimeUsd + speech.costUsd,
    built.promptHash,
  );
}

async function runTranscript(
  db: ReturnType<typeof openDatabase>,
  fixture: PreparedFixture,
  preset: TutorPromptPreset,
): Promise<Cell> {
  const selected = buildSelectedTutorPrompt(db, "transcript", preset);
  const started = performance.now();
  const transcript = await openAiTutorSpeechToText.transcribe({
    audio: fixture.mp3,
    mimeType: "audio/mpeg",
    language: "it",
  });
  let completion = await openAiTerraClient.complete({
    prompt: selected.prompt,
    transcript: transcript.text,
    context: [],
  });
  let modelUsd = terraUsageCost(completion.usage).totalUsd;
  let parsed: ParsedTutorTurn | null = null;
  try {
    parsed = parseTutorTurnResult(completion.text, { allowPronunciation: false });
  } catch (error) {
    if (!(error instanceof TutorTurnParseError)) throw error;
    completion = await openAiTerraClient.complete({
      prompt: selected.prompt,
      transcript: transcript.text,
      context: [],
      repairOf: completion.text,
    });
    modelUsd += terraUsageCost(completion.usage).totalUsd;
    try {
      parsed = parseTutorTurnResult(completion.text, { allowPronunciation: false });
    } catch (repairError) {
      if (!(repairError instanceof TutorTurnParseError)) throw repairError;
    }
  }
  const sttUsd = sttCallCost(TUTOR_STT_MODEL, fixture.durationSeconds);
  if (!parsed) {
    return assess(fixture, "transcript", preset, null, null, sttUsd + modelUsd, selected.promptHash);
  }
  const speechStarted = performance.now();
  const speech = await synthesize(parsed.result.reply);
  const firstAudioMs = speechStarted - started + speech.firstMs;
  return assess(
    fixture,
    "transcript",
    preset,
    parsed,
    firstAudioMs,
    sttUsd + modelUsd + speech.costUsd,
    selected.promptHash,
  );
}

function mark(value: boolean | null): string {
  return value === null ? "—" : value ? "yes" : "no";
}

function report(cells: readonly Cell[], spendUsd: number): string {
  const lines = cells.map(
    (cell) =>
      `| ${cell.fixture} | ${cell.architecture} | ${cell.preset} | ${mark(cell.caught)} | ${mark(cell.missed)} | ${mark(cell.falseCorrection)} | ${mark(cell.parseFailure)} | ${cell.firstAudioMs === null ? "—" : Math.round(cell.firstAudioMs)} | ${cell.costUsd.toFixed(6)} | ${cell.errors} |`,
  );
  const hashes = [...new Map(cells.map((cell) => [`${cell.architecture}/${cell.preset}`, cell.promptHash])).entries()]
    .map(([label, hash]) => `- ${label}: \`${hash}\``)
    .join("\n");
  return `# Spike 8 — Tutor model and prompt lab

Date: 2026-07-26 · Live spend: **$${spendUsd.toFixed(6)}** modelled/usage-derived · Hard ceiling: **$${HARD_SPEND_USD.toFixed(2)}**

## Method

Five labelled Italian sentences were synthesized once with ${TTS_MODEL}/${VOICE}; G1–G3 contain planted grammar or word-choice errors and C1–C2 are correct controls. The same MP3 was sent through ${TUTOR_STT_MODEL} → ${TERRA_MODEL} and decoded to 24 kHz PCM16 for ${REALTIME_FLAGSHIP}. Every successful parsed reply used the same streaming ${TTS_MODEL}/${VOICE} output leg. Realtime and Terra each received one bounded repair after invalid structured output.

Latency is capture-commit to first TTS provider audio, not playback completion. Realtime/Terra costs are usage-derived where usage was available; STT and TTS are modelled from measured duration/bytes at the repository's conservative rates. The harness would stop before any cell whose $${NEXT_CELL_RESERVE_USD.toFixed(2)} reserve could cross $${HARD_SPEND_USD.toFixed(2)}.

These are synthetic TTS fixtures. They prove plumbing and provide controlled comparative observations; they do **not** represent hesitant real learners, preserve natural pronunciation variation, or justify crowning a winning architecture or preset.

## Results

| Fixture | Architecture | Preset | Caught | Missed | False correction | Parse failure | First audio ms | Cost USD | Error categories |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
${lines.join("\n")}

## Prompt hashes

${hashes}

## Contract facts

- Native: ${REALTIME_FLAGSHIP}, GA \`/v1/realtime\`, \`output_modalities: ["text"]\`, \`turn_detection: null\`, one \`input_audio_buffer.commit\` then one \`response.create\`.
- Transcript: ${TUTOR_STT_MODEL} with \`language=it\`, then ${TERRA_MODEL} Responses API with \`reasoning: { effort: "${TERRA_REASONING_EFFORT}" }\` and strict \`text.format.type: "json_schema"\`.
- Common output: ${TTS_MODEL}, \`response_format: "mp3"\`, \`stream_format: "sse"\`, voice \`${VOICE}\`.

## Interpretation limit

The matrix is retained as operator evidence, including misses, false corrections, and parse failures. No winner is selected. Human use with spontaneous, hesitant speech remains the decision input.
`;
}

async function main() {
  key();
  const outputArg = process.argv.indexOf("--output");
  const output =
    outputArg >= 0
      ? path.resolve(process.argv[outputArg + 1])
      : path.resolve("docs/research/spike-8-tutor-model-prompt-lab.md");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-lab-"));
  const db = openDatabase(path.join(root, "erika.db"));
  const cells: Cell[] = [];
  let spendUsd = 0;
  try {
    const fixtures: PreparedFixture[] = [];
    for (const fixture of FIXTURES) {
      const prepared = await prepareFixture(root, fixture);
      fixtures.push(prepared);
      spendUsd += prepared.setupTtsUsd;
    }
    for (const architecture of ["native", "transcript"] as const) {
      for (const preset of TUTOR_PRESETS) {
        for (const fixture of fixtures) {
          if (spendUsd + NEXT_CELL_RESERVE_USD > HARD_SPEND_USD) {
            throw new Error(`Hard spend ceiling reached before ${architecture}/${preset}/${fixture.id}.`);
          }
          const cell =
            architecture === "native"
              ? await runNative(db, fixture, preset)
              : await runTranscript(db, fixture, preset);
          cells.push(cell);
          spendUsd += cell.costUsd;
          process.stdout.write(
            `${cells.length}/50 ${architecture}/${preset}/${fixture.id} $${spendUsd.toFixed(4)}\n`,
          );
        }
      }
    }
    fs.writeFileSync(output, report(cells, spendUsd));
    process.stdout.write(`WROTE ${output}\nLIVE_SPEND_USD=${spendUsd.toFixed(6)}\n`);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main();
