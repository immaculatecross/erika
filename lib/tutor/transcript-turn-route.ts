import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import { getDb } from "../db";
import { FfprobeError, probeDurationSeconds } from "../ffprobe";
import { readSettings } from "../settings";
import { releaseReservation } from "../analysis/budget";
import { getConversation } from "./conversations";
import { MAX_TRANSCRIPT_TURN_SECONDS, isTutorPromptPreset } from "./experiment";
import { buildSelectedTutorPrompt } from "./session-config";
import {
  MAX_TUTOR_CONTEXT_CHARS,
  boundedTutorContext,
  openAiTerraClient,
  type TerraClient,
  type TutorContextTurn,
} from "./terra";
import {
  parseTutorTurnResult,
  TURN_RECOVERY_MESSAGE,
  TutorTurnParseError,
} from "./turn-result";
import {
  reserveTerraLeg,
  reserveTranscriptLeg,
  settleTerraLeg,
  settleTranscriptLeg,
  transcriptTurnStarted,
} from "./turn-money";
import { openAiTutorSpeechToText } from "../voice/openai-speech";
import type { SpeechToText } from "../voice/speech";

export const MAX_TUTOR_TURN_BYTES = 16 * 1024 * 1024;
export const MAX_TUTOR_TURN_SECONDS = MAX_TRANSCRIPT_TURN_SECONDS;

interface TurnDeps {
  stt?: SpeechToText;
  terra?: TerraClient;
  probe?: typeof probeDurationSeconds;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseContext(raw: string): TutorContextTurn[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return boundedTutorContext(
      value
        .filter((item) => typeof item === "object" && item !== null)
        .map((item) => ({
          learner: typeof item.learner === "string" ? item.learner.slice(0, 4000) : "",
          tutor: typeof item.tutor === "string" ? item.tutor.slice(0, 2000) : "",
        }))
        .filter((item) => item.learner || item.tutor),
    );
  } catch {
    return [];
  }
}

function recoverable(
  costs: { transcriptionUsd: number; modelUsd: number },
  status = 502,
): NextResponse {
  return NextResponse.json(
    {
      error: { code: "unreadable_turn", message: TURN_RECOVERY_MESSAGE },
      recoverable: true,
      costs: { ...costs, committedUsd: costs.transcriptionUsd + costs.modelUsd },
    },
    { status },
  );
}

export async function handleTranscriptTurn(
  request: Request,
  deps: TurnDeps = {},
): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_TUTOR_TURN_BYTES + 128_000) {
    return NextResponse.json(
      { error: { code: "turn_too_large", message: "That turn is longer than two minutes can contain." } },
      { status: 413 },
    );
  }
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "The turn must be multipart audio." } },
      { status: 400 },
    );
  }
  const tutorId = field(form, "tutorId");
  const seq = field(form, "seq");
  const preset = field(form, "preset");
  const audio = form.get("audio");
  if (!tutorId || !seq || !isTutorPromptPreset(preset) || !(audio instanceof Blob)) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "tutorId, seq, preset, and audio are required." } },
      { status: 400 },
    );
  }
  if (audio.size <= 0 || audio.size > MAX_TUTOR_TURN_BYTES || !audio.type.startsWith("audio/")) {
    return NextResponse.json(
      { error: { code: "invalid_audio", message: "That turn is empty, too large, or not labelled as audio." } },
      { status: audio.size > MAX_TUTOR_TURN_BYTES ? 413 : 422 },
    );
  }

  const db = getDb();
  const conversation = getConversation(db, tutorId);
  if (!conversation || conversation.endedAt !== null) {
    return NextResponse.json(
      { error: { code: "session_closed", message: "That conversation is no longer open." } },
      { status: 409 },
    );
  }
  if (transcriptTurnStarted(db, tutorId, seq)) {
    return NextResponse.json(
      { error: { code: "duplicate_turn", message: "That turn was already submitted." } },
      { status: 409 },
    );
  }

  const extension = audio.type.split("/")[1]?.split(";")[0] || "webm";
  const staged = path.join(tmpdir(), `erika-tutor-turn-${randomUUID()}.${extension}`);
  let durationSeconds: number;
  const bytes = new Uint8Array(await audio.arrayBuffer());
  try {
    await fs.writeFile(staged, bytes);
    durationSeconds = await (deps.probe ?? probeDurationSeconds)(staged);
  } catch (error) {
    if (error instanceof FfprobeError) {
      return NextResponse.json(
        { error: { code: "undecodable_audio", message: error.message } },
        { status: 422 },
      );
    }
    throw error;
  } finally {
    await fs.rm(staged, { force: true });
  }
  if (durationSeconds > MAX_TUTOR_TURN_SECONDS) {
    return NextResponse.json(
      { error: { code: "turn_too_long", message: "A conversation turn may be at most two minutes." } },
      { status: 413 },
    );
  }

  const settings = readSettings(db);
  const sttReservation = reserveTranscriptLeg(db, {
    tutorId,
    seq,
    durationSeconds,
    budgetUsd: settings.monthlyBudgetUsd,
  });
  if (!sttReservation) {
    return NextResponse.json(
      { error: { code: "budget", message: "The monthly budget cannot cover this turn. No provider was called." } },
      { status: 402 },
    );
  }

  const transcriptionStarted = performance.now();
  let transcript;
  try {
    transcript = await (deps.stt ?? openAiTutorSpeechToText).transcribe({
      audio: bytes,
      mimeType: audio.type,
      language: "it",
    });
  } catch (error) {
    releaseReservation(db, sttReservation);
    throw error;
  }
  const transcriptionMs = performance.now() - transcriptionStarted;
  const transcriptionUsd = settleTranscriptLeg(db, sttReservation, durationSeconds);

  const context = parseContext(field(form, "context"));
  const { prompt, promptHash } = buildSelectedTutorPrompt(db, "transcript", preset);
  const contextForCost = JSON.stringify(context).slice(0, MAX_TUTOR_CONTEXT_CHARS);
  let modelUsd = 0;
  let modelMs = 0;
  let completion;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reservation = reserveTerraLeg(db, {
      tutorId,
      seq,
      prompt,
      context: `${contextForCost}\n${transcript.text}`,
      budgetUsd: settings.monthlyBudgetUsd,
      repair: attempt === 1,
    });
    if (!reservation) return recoverable({ transcriptionUsd, modelUsd }, 402);
    const modelStarted = performance.now();
    try {
      completion = await (deps.terra ?? openAiTerraClient).complete({
        prompt,
        transcript: transcript.text,
        context,
        ...(attempt === 1 && completion ? { repairOf: completion.text } : {}),
      });
    } catch (error) {
      releaseReservation(db, reservation);
      throw error;
    }
    modelMs += performance.now() - modelStarted;
    modelUsd += settleTerraLeg(db, reservation, completion.usage);
    try {
      const parsed = parseTutorTurnResult(completion.text, { allowPronunciation: false });
      return NextResponse.json({
        result: parsed.result,
        droppedErrors: parsed.droppedErrors,
        transcript: transcript.text,
        promptHash,
        usage: completion.usage,
        latency: { transcriptionMs, modelMs },
        costs: {
          transcriptionUsd,
          modelUsd,
          committedUsd: transcriptionUsd + modelUsd,
        },
      });
    } catch (error) {
      if (!(error instanceof TutorTurnParseError)) throw error;
    }
  }
  return recoverable({ transcriptionUsd, modelUsd });
}
