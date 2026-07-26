import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { REALTIME_FLAGSHIP, TERRA_MODEL, TTS_MODEL, TUTOR_STT_MODEL } from "@/lib/analysis/rates";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";
import { buildTutorSessionConfig } from "@/lib/tutor/session-config";
import { manualTurnEvents } from "@/lib/tutor/realtime-client";
import { openAiTerraClient, TERRA_REASONING_EFFORT } from "@/lib/tutor/terra";
import { TUTOR_OUTPUT_CONTRACT } from "@/lib/tutor/prompt-presets";
import { parseTutorTurnResult } from "@/lib/tutor/turn-result";
import {
  openAiTextToSpeech,
  openAiTutorSpeechToText,
} from "@/lib/voice/openai-speech";

// Cheapest real calls that prove the production request builders. CI skips without a
// key. Assertions cover supported fields and parsability, never stochastic quality.
const KEY = process.env.OPENAI_API_KEY;
const live = KEY ? describe : describe.skip;
const execFileAsync = promisify(execFile);

let speechFixture: Promise<Uint8Array> | null = null;
function ttsFixture(): Promise<Uint8Array> {
  if (!speechFixture) {
    speechFixture = (async () => {
      const tts = openAiTextToSpeech("coral");
      const chunks: Uint8Array[] = [];
      for await (const chunk of tts.synthesizeStream!({
        text: "Ieri ho andato al cinema.",
        language: "it",
      })) {
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      expect(bytes.byteLength).toBeGreaterThan(100);
      return new Uint8Array(bytes);
    })();
  }
  return speechFixture;
}

async function pcmFixture(): Promise<Uint8Array> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-live-realtime-"));
  const mp3 = path.join(dir, "turn.mp3");
  const pcm = path.join(dir, "turn.pcm");
  try {
    fs.writeFileSync(mp3, await ttsFixture());
    await execFileAsync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-i",
      mp3,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      pcm,
    ]);
    return new Uint8Array(fs.readFileSync(pcm));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function realtimeManualTurn(audio: Uint8Array): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-live-config-"));
  const db = openDatabase(path.join(dir, "erika.db"));
  const wire = buildMintSessionWireBody(
    buildTutorSessionConfig(db, undefined, "minimal").config,
  );
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_FLAGSHIP)}`,
      {
        headers: {
          authorization: `Bearer ${KEY}`,
        },
      },
    );
    let text = "";
    const eventTypes = new Set<string>();
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Realtime text-out smoke timed out."));
    }, 30_000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(text);
    };
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "session.update", session: wire }));
    });
    socket.on("message", (raw) => {
      const event = JSON.parse(String(raw)) as {
        type?: string;
        delta?: string;
        error?: { message?: string };
        response?: {
          status?: string;
          status_details?: { error?: { message?: string } };
          output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
        };
      };
      if (event.type) eventTypes.add(event.type);
      if (event.type === "session.updated") {
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: Buffer.from(audio).toString("base64"),
          }),
        );
        for (const turnEvent of manualTurnEvents()) {
          socket.send(JSON.stringify(turnEvent));
        }
      } else if (
        event.type === "response.output_text.delta" &&
        typeof event.delta === "string"
      ) {
        text += event.delta;
      } else if (event.type === "response.done") {
        if (!text) {
          text =
            event.response?.output
              ?.flatMap((item) => item.content ?? [])
              .filter((part) => part.type === "output_text")
              .map((part) => part.text ?? "")
              .join("") ?? "";
        }
        if (!text) {
          finish(
            new Error(
              event.response?.status_details?.error?.message ??
                `Realtime returned no text (${[...eventTypes].join(", ")}).`,
            ),
          );
        } else {
          finish();
        }
      } else if (event.type === "error") {
        finish(new Error(event.error?.message ?? "Realtime contract error."));
      }
    });
    socket.on("error", () => finish(new Error("Realtime WebSocket failed.")));
  });
}

live("live: tutor lab provider contracts", () => {
  it("streams one reply through the production gpt-4o-mini-tts builder", async () => {
    const bytes = await ttsFixture();
    expect(TTS_MODEL).toBe("gpt-4o-mini-tts");
    expect(bytes.byteLength).toBeGreaterThan(100);
  }, 30_000);

  it("transcribes one bounded Italian fixture with gpt-4o-transcribe", async () => {
    const transcript = await openAiTutorSpeechToText.transcribe({
      audio: await ttsFixture(),
      mimeType: "audio/mpeg",
      language: "it",
    });
    expect(TUTOR_STT_MODEL).toBe("gpt-4o-transcribe");
    expect(transcript.source).toContain(TUTOR_STT_MODEL);
    expect(typeof transcript.text).toBe("string");
    expect(transcript.text.length).toBeGreaterThan(0);
  }, 30_000);

  it("accepts Terra low reasoning plus strict structured output", async () => {
    const completion = await openAiTerraClient.complete({
      prompt: `Inspect the Italian sentence and obey this contract.\n\n${TUTOR_OUTPUT_CONTRACT}`,
      transcript: "Ieri ho andato al cinema.",
      context: [],
    });
    expect(TERRA_MODEL).toBe("gpt-5.6-terra");
    expect(TERRA_REASONING_EFFORT).toBe("low");
    expect(completion.responseId).toBeTruthy();
    expect(parseTutorTurnResult(completion.text, { allowPronunciation: false }).result.reply).toBeTruthy();
  }, 30_000);

  it("completes one manual Realtime 2.1 audio-in/text-out turn", async () => {
    const text = await realtimeManualTurn(await pcmFixture());
    expect(text.length).toBeGreaterThan(0);
  }, 45_000);
});
