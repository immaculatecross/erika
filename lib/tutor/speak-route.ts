import { NextResponse } from "next/server";
import { getDb } from "../db";
import { readSettings } from "../settings";
import { releaseReservation } from "../analysis/budget";
import { TTS_MODEL } from "../analysis/rates";
import { getConversation } from "./conversations";
import { MAX_TUTOR_REPLY_CHARS } from "./experiment";
import {
  reserveTutorSpeech,
  settleTutorSpeech,
  tutorSpeechStarted,
} from "./money";
import {
  TTS_MIME_TYPE,
  openAiTextToSpeech,
} from "../voice/openai-speech";
import {
  VoiceUnavailableError,
  type TextToSpeech,
} from "../voice/speech";

export const MAX_SPEAK_CHARS = MAX_TUTOR_REPLY_CHARS;

export async function handleSpeak(
  request: Request,
  deps: { tts?: TextToSpeech } = {},
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    tutorId?: unknown;
    seq?: unknown;
    text?: unknown;
  };
  const tutorId = typeof body.tutorId === "string" ? body.tutorId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const seq =
    typeof body.seq === "number" || typeof body.seq === "string"
      ? String(body.seq)
      : "";
  if (!tutorId || !seq || !text || text.length > MAX_SPEAK_CHARS) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "A bounded tutorId, seq, and reply are required." } },
      { status: 400 },
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
  if (tutorSpeechStarted(db, tutorId, seq)) {
    return NextResponse.json(
      { error: { code: "duplicate_turn", message: "That reply was already requested." } },
      { status: 409 },
    );
  }
  const settings = readSettings(db);
  const tts = deps.tts ?? openAiTextToSpeech(settings.tutorVoice);
  if (!tts.isAvailable()) {
    return NextResponse.json(
      { error: { code: "tutor_unavailable", message: "Erika needs an OpenAI API key to speak." } },
      { status: 503 },
    );
  }

  const reservation = reserveTutorSpeech(
    db,
    tutorId,
    seq,
    text,
    settings.monthlyBudgetUsd,
  );
  if (!reservation) {
    return NextResponse.json(
      { error: { code: "budget", message: "The monthly budget cannot cover the spoken reply. No provider was called." } },
      { status: 402 },
    );
  }

  let iterator: AsyncIterator<Uint8Array>;
  let first: IteratorResult<Uint8Array>;
  try {
    const chunks = tts.synthesizeStream
      ? tts.synthesizeStream({ text, language: "it" })
      : oneChunk(await tts.synthesize({ text, language: "it" }));
    iterator = chunks[Symbol.asyncIterator]();
    first = await iterator.next();
  } catch (error) {
    releaseReservation(db, reservation);
    if (error instanceof VoiceUnavailableError) {
      return NextResponse.json(
        { error: { code: "tutor_unavailable", message: error.message } },
        { status: 503 },
      );
    }
    throw error;
  }
  if (first.done || first.value.byteLength === 0) {
    releaseReservation(db, reservation);
    return NextResponse.json(
      { error: { code: "tutor_unavailable", message: "The speech service returned no audio." } },
      { status: 503 },
    );
  }

  let bytes = first.value.byteLength;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    settleTutorSpeech(db, reservation, text, bytes);
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(first.value);
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          bytes += next.value.byteLength;
          controller.enqueue(next.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        settle();
      }
    },
    cancel() {
      settle();
      void iterator.return?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": TTS_MIME_TYPE,
      "cache-control": "no-store",
      "x-tutor-voice": tts.voice,
      "x-tutor-model": TTS_MODEL,
      "x-tutor-cost-usd": reservation.costUsd.toFixed(8),
      "x-tutor-cost-kind": "modelled",
    },
  });
}

async function* oneChunk(speech: { audio: Uint8Array }): AsyncIterable<Uint8Array> {
  yield speech.audio;
}
