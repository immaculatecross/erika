import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { TTS_MIME_TYPE, openAiTextToSpeech } from "@/lib/voice/openai-speech";
import { VoiceUnavailableError, type TextToSpeech } from "@/lib/voice/speech";
import { reserveTutorSpeech, settleTutorSpeech } from "@/lib/tutor/money";

// The tutor's SPEAKING leg (E-43, D-28). The learner's turn is heard natively by the
// Realtime session; the reply comes back as TEXT; this route turns one chunk of that
// text into audio and streams it to the browser as it arrives.
//
// SECRET BOUNDARY: the vendor call happens HERE, server-side. The browser gets audio
// bytes and never a key — the same never-waivable rule the ephemeral mint enforces for
// the listening leg.
//
// STREAMING IS NOT AN OPTIMIZATION HERE. spike-5 §4 measured full synthesis at 2.415 s
// against SSE time-to-first-byte of 0.844 s; blocking would put a turn at ~4.6 s,
// worse than the Realtime tutor this replaces. So the response is a chunked audio
// stream, forwarded through as the vendor's SSE deltas decode.
//
// MONEY: reserve-before-call, finalize-on-resolve, on the one ledger under the one cap
// (lib/tutor/money.ts states the invariant and enumerates the paths). A cap refusal
// returns 402 having made NO vendor call and minted NO charge. A stream that dies
// halfway still bills for the bytes that arrived, because those were synthesized and
// invoiced; and if the process dies outright, `tutor-tts:` is an assumed-run prefix so
// the sweep commits rather than releases.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longest reply chunk we will synthesize in one request. A tutor turn is a couple of
 *  sentences; anything past this is a runaway, and a runaway must not become a
 *  runaway charge. */
export const MAX_SPEAK_CHARS = 1200;

export async function POST(request: Request): Promise<Response> {
  return handleSpeak(request);
}

/**
 * The route's whole behaviour, with the vendor INJECTED — the house pattern
 * (`AudioModelClient`, `SpeakerEmbedder`): the caller chooses the implementation, no
 * module-level singleton decides, and the test drives it with a plain fake that makes
 * no network call. `POST` is the thin Next.js binding.
 */
export async function handleSpeak(request: Request, deps: { tts?: TextToSpeech } = {}): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    tutorId?: unknown;
    seq?: unknown;
    text?: unknown;
  };
  const tutorId = typeof body.tutorId === "string" ? body.tutorId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const seq = typeof body.seq === "number" || typeof body.seq === "string" ? String(body.seq) : "0";
  if (!tutorId || !text) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "tutorId and text are required." } },
      { status: 400 },
    );
  }
  if (text.length > MAX_SPEAK_CHARS) {
    return NextResponse.json(
      { error: { code: "too_long", message: `A reply chunk may be at most ${MAX_SPEAK_CHARS} characters.` } },
      { status: 400 },
    );
  }

  const db = getDb();
  const settings = readSettings(db);
  const tts = deps.tts ?? openAiTextToSpeech(settings.tutorVoice);

  if (!tts.isAvailable()) {
    return NextResponse.json(
      {
        error: {
          code: "tutor_unavailable",
          message: "Erika needs an OpenAI API key to speak. Add one in Settings and start again.",
        },
      },
      { status: 503 },
    );
  }

  // Reserve BEFORE the vendor is touched. A refusal here makes no call and no charge.
  const reservation = reserveTutorSpeech(db, tutorId, seq, text, settings.monthlyBudgetUsd);
  if (!reservation) {
    return NextResponse.json(
      {
        error: {
          code: "budget",
          message: "The monthly budget cannot cover more of this conversation.",
        },
      },
      { status: 402 },
    );
  }

  let bytes = 0;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    settleTutorSpeech(db, reservation, text, bytes);
  };

  try {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const chunks = tts.synthesizeStream
            ? tts.synthesizeStream({ text, language: "it" })
            : singleChunk(await tts.synthesize({ text, language: "it" }));
          for await (const chunk of chunks) {
            bytes += chunk.byteLength;
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (err) {
          // Bytes already delivered were synthesized and billed; the rest was not.
          controller.error(err);
        } finally {
          settle();
        }
      },
      cancel() {
        // The learner barged in and aborted playback. Whatever arrived was billed.
        settle();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": TTS_MIME_TYPE,
        "cache-control": "no-store",
        "x-tutor-voice": tts.voice,
      },
    });
  } catch (err) {
    settle();
    if (err instanceof VoiceUnavailableError) {
      return NextResponse.json({ error: { code: "tutor_unavailable", message: err.message } }, { status: 503 });
    }
    throw err;
  }
}

async function* singleChunk(speech: { audio: Uint8Array }): AsyncIterable<Uint8Array> {
  yield speech.audio;
}
