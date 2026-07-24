import { TTS_MODEL } from "../analysis/rates";

// The ONE module that talks to OpenAI's text-to-speech model for E-21 (contrastive
// playback). Everything network-shaped is isolated here behind a typed
// `TtsModelClient`, so the render-once engine, its cost, and the budget cap are all
// unit-tested against a mock and no CI test ever makes a real call — the same
// discipline as lib/analysis/audio-model.ts and lib/lessons/text-model.ts (D-10,
// D-13). The API key is read from the environment at call time and never logged.
//
// The correction text goes in; mp3 audio bytes come back. The billing unit is
// input characters (lib/analysis/rates.ts is the single price knob); the caller
// charges the actual character count into the shared spend_ledger.

/** Thrown when the TTS model/endpoint is unavailable or unauthorized (a blocker). */
export class TtsModelUnavailableError extends Error {}

/** One synthesized clip: the audio bytes and their container format. */
export interface TtsResult {
  /** The rendered audio. */
  audio: Buffer;
  /** Container format, e.g. "mp3". */
  format: string;
}

/** The seam the render engine depends on. The real impl calls OpenAI; tests mock it. */
export interface TtsModelClient {
  /** Synthesize `text` in `voice`, returning the audio bytes and their format.
   *  `instructions` is the register-aware delivery style (E-33, D-23) — a free-text
   *  steer gpt-4o-mini-tts accepts; it changes HOW the phrase is spoken, never the
   *  text. Optional: absent behaves exactly as before the dial existed. */
  synthesize(input: { text: string; voice?: string; instructions?: string }): Promise<TtsResult>;
}

// ---- the real OpenAI client ---------------------------------------------

const OPENAI_URL = "https://api.openai.com/v1/audio/speech";
/** A neutral default voice; a per-user voice choice is out of scope (E-21 WO). */
const DEFAULT_VOICE = "alloy";
const FORMAT = "mp3";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TtsModelUnavailableError("OPENAI_API_KEY is not set.");
  return key;
}

/** The production client. Kept thin: send text → return audio bytes + format. */
export const openAiTtsModel: TtsModelClient = {
  async synthesize({ text, voice, instructions }) {
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify({
          model: TTS_MODEL,
          input: text,
          voice: voice ?? DEFAULT_VOICE,
          response_format: FORMAT,
          // The register-aware delivery steer (E-33, D-23); omitted when absent so
          // pre-dial behaviour is byte-identical.
          ...(instructions ? { instructions } : {}),
        }),
      });
    } catch (err) {
      throw new TtsModelUnavailableError(`Network error calling ${TTS_MODEL}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 4xx around auth/model are legitimate "stop, don't retry-thrash" blockers.
      throw new TtsModelUnavailableError(`${TTS_MODEL} call failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, format: FORMAT };
  },
};
