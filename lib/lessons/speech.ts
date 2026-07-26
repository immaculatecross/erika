import type { Db } from "../db";
import { readSettings } from "../settings";
import { finalizeReservation, releaseReservation, reserveSpend } from "../analysis/budget";
import { STT_MODEL, sttCallCost } from "../analysis/rates";
import { BudgetExceededError } from "./billing";

// ─────────────────────────────────────────────────────────────────────────────
// THE STT SEAM FOR DRILL ANSWERS (E-45 criterion 2, D-28).
//
// The narrowest possible speech-to-text in this product, and the narrowness is
// load-bearing. D-3 forbids transcribing speech to find errors — spike-6 measured
// `whisper-1` silently CORRECTING a learner's planted mistakes, which is exactly
// the signal loss D-3 was written about. D-21 and D-28 carve out one exception:
// SCRIPTED assessment, where the answer is already known, because comparing a word
// to a known word is not diagnosis.
//
// So this module transcribes ONE drill answer and returns text. It never sees a
// capture, never sees a tutor turn, never sees anything spontaneous, and it does
// not judge — `lib/lessons/spoken-answer.ts` does the comparing, deterministically
// and for free. There is no billed grading call anywhere in the drill path.
//
// Injected exactly as `AudioModelClient` and `SpeakerEmbedder` are, so tests drive
// a mock and no CI test ever makes a real call.
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when transcription is unavailable (no key, network, provider error). */
export class SpeechUnavailableError extends Error {}

export interface TranscriptionInput {
  /** base64-encoded audio of ONE drill answer. */
  audioBase64: string;
  /** Container format, e.g. "wav". */
  format: string;
  /** BCP-47 hint, e.g. "it" — a known-language hint materially improves accuracy. */
  language: string;
  /** Duration in seconds; what the reservation is priced on. */
  seconds: number;
}

export interface Transcription {
  /** What the recogniser heard. Never stored, never analysed — compared and dropped. */
  text: string;
}

/** The seam the drill answer route depends on. The real impl calls OpenAI. */
export interface SpeechToText {
  transcribe(input: TranscriptionInput): Promise<Transcription>;
}

/**
 * The longest drill answer we will pay to transcribe.
 *
 * A drill answer is a word or a short sentence. Fifteen seconds is generous for
 * that and mean for anything else, which is the point: it bounds what one tap can
 * cost, and it keeps this path structurally unable to become a channel for
 * spontaneous speech — you cannot smuggle a conversation through a 15-second cap.
 */
export const MAX_DRILL_ANSWER_SECONDS = 15;

/**
 * The byte ceiling for one drill answer, and the reason the duration is not trusted.
 *
 * [Full review, non-blocking] The reservation used to be priced on a `seconds` value
 * the CLIENT declared, so a client claiming `seconds: 0` reserved nothing and then
 * sent whatever it liked — the cap guarded a number the caller chose. Duration is now
 * ignored for pricing entirely (see `transcribeDrillAnswer`) and the payload is
 * bounded here instead, on the one quantity the server can actually see.
 *
 * 16-bit mono PCM at 48 kHz is ~96 kB/s, so 15 seconds is ~1.4 MB; 2 MB leaves room
 * for a WAV header and a higher sample rate without leaving room for a conversation.
 */
export const MAX_DRILL_ANSWER_BYTES = 2 * 1024 * 1024;

/** Thrown when a drill answer is larger than one drill answer can be. */
export class DrillAnswerTooLargeError extends Error {}

const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new SpeechUnavailableError("OPENAI_API_KEY is not set.");
  return key;
}

/** The production client. Kept thin: audio in, text out, no interpretation. */
export const openAiSpeechToText: SpeechToText = {
  async transcribe({ audioBase64, format, language }) {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audioBase64, "base64")]), `answer.${format}`);
    form.append("model", STT_MODEL);
    form.append("language", language);
    form.append("response_format", "text");

    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}` },
        body: form,
      });
    } catch (err) {
      throw new SpeechUnavailableError(`Network error calling ${STT_MODEL}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SpeechUnavailableError(`${STT_MODEL} call failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    return { text: (await res.text()).trim() };
  },
};

/**
 * Transcribe one drill answer under the shared monthly cap, reserve-before-call.
 *
 * The reservation is priced on the CAPPED duration, so the worst case is known
 * before the call and a cap refusal mints no charge. A failed call releases the
 * reservation (nothing was billed); a successful one finalizes to the same figure,
 * because the provider bills on audio duration and we already know it.
 *
 * `contentHash` keys the ledger row on the drill, not on the audio: two attempts at
 * the same drill are two real calls and must be two real charges.
 */
export async function transcribeDrillAnswer(
  db: Db,
  client: SpeechToText,
  input: { audioBase64: string; format: string; seconds: number; drillKey: string },
): Promise<Transcription> {
  const { monthlyBudgetUsd, targetLanguage } = readSettings(db);

  // Bound what we are willing to be sent, on the one quantity the server can see.
  const bytes = Math.ceil((input.audioBase64.length * 3) / 4);
  if (bytes > MAX_DRILL_ANSWER_BYTES) {
    throw new DrillAnswerTooLargeError("That answer is longer than a drill answer can be.");
  }

  // PRICED AT THE CEILING, NOT AT THE DECLARED DURATION. `input.seconds` comes from
  // the browser and a caller that declares zero would otherwise reserve zero — a cap
  // that guards a number the caller chose is not a cap. Charging every answer as if
  // it ran the full MAX_DRILL_ANSWER_SECONDS over-books by a fraction of a cent on a
  // two-second answer, which is the safe direction: over-estimating costs a slightly
  // early refusal, under-estimating makes the cap a lie (lib/analysis/rates.ts).
  const seconds = MAX_DRILL_ANSWER_SECONDS;
  const costUsd = sttCallCost(STT_MODEL, seconds);

  const reservation = reserveSpend(
    db,
    { model: STT_MODEL, contentHash: `stt:${input.drillKey}:${Date.now()}`, costUsd },
    monthlyBudgetUsd,
  );
  if (!reservation) throw new BudgetExceededError();

  let result: Transcription;
  try {
    result = await client.transcribe({
      audioBase64: input.audioBase64,
      format: input.format,
      language: languageHint(targetLanguage),
      seconds,
    });
  } catch (err) {
    releaseReservation(db, reservation); // no completion, no charge
    throw err;
  }
  finalizeReservation(db, reservation, costUsd);
  return result;
}

/** Settings stores a language NAME ("Italian"); the API wants a code. Unknown
 *  names fall through to no hint rather than to a wrong one. */
function languageHint(targetLanguage: string): string {
  const known: Record<string, string> = {
    italian: "it", spanish: "es", french: "fr", german: "de", portuguese: "pt", english: "en",
  };
  return known[targetLanguage.trim().toLowerCase()] ?? "";
}
