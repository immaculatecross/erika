import {
  PronunciationParseError,
  PronunciationScorerUnavailableError,
  type PronunciationScoreInput,
  type PronunciationScorer,
} from "./scorer";
import {
  isPronunciationErrorType,
  type PhonemeAlternate,
  type PronouncedPhoneme,
  type PronouncedWord,
  type PronunciationErrorType,
  type PronunciationResult,
} from "./types";

// The ONE module that talks to Azure AI Speech's Pronunciation Assessment (E-37,
// D-21). Everything network-shaped and every secret read lives here, behind the
// `PronunciationScorer` seam — the same discipline as lib/analysis/audio-model.ts,
// lib/lessons/text-model.ts and lib/render/tts-model.ts (D-10, D-13). No CI test
// makes a real call; the sandbox has no key and no egress.
//
// SECRET HYGIENE (WO criterion 6). `AZURE_SPEECH_KEY` is read from the environment at
// CALL TIME and never leaves this file: it is not returned, not embedded in a URL, not
// put in an error message (`describeFailure` deliberately reports only status/shape),
// and this module is imported only by server-side code. Mirrors how the E-34 Realtime
// path keeps the real OpenAI key server-side while the browser only ever sees an
// ephemeral secret.
//
// THE CALL (OBS-002, live-verified 2026-07-24 — do not re-derive):
//
//   POST {base}/stt/speech/recognition/conversation/cognitiveservices/v1
//        ?language=it-IT&format=detailed
//   Ocp-Apim-Subscription-Key: $AZURE_SPEECH_KEY
//   Content-Type: audio/wav; codecs=audio/pcm; samplerate=16000
//   Pronunciation-Assessment: base64(JSON)
//
// with the assessment JSON below. `EnableProsodyAssessment` is NEVER set: prosody is
// en-US only, so for it-IT it returns nothing and it is the only add-on-billed score
// — setting it would buy us a bigger invoice and no data.

/** The one locale this scorer assesses. Scripted Italian drills only (D-21/D-3). */
export const PA_LANGUAGE = "it-IT";

/** The REST short-audio recognition path, appended to the resource base. */
const PA_PATH = "/stt/speech/recognition/conversation/cognitiveservices/v1";

/** The audio contract Azure expects (and the Responsible AI doc's ≥16 kHz advice). */
export const PA_CONTENT_TYPE = "audio/wav; codecs=audio/pcm; samplerate=16000";

export interface AzureSpeechConfig {
  key: string;
  region: string | null;
  /** An explicit resource/private endpoint base, e.g. `https://x.cognitiveservices.azure.com`. */
  endpoint: string | null;
}

/**
 * Read the Azure credentials from the environment, or null when the key is absent —
 * the honest missing-key wall's trigger. A key with neither a region nor an endpoint
 * is unusable (there is no host to call), so that is null too rather than a runtime
 * surprise mid-drill.
 */
export function azureSpeechConfig(
  env: Record<string, string | undefined> = process.env,
): AzureSpeechConfig | null {
  const key = (env.AZURE_SPEECH_KEY ?? "").trim();
  if (!key) return null;
  const region = (env.AZURE_SPEECH_REGION ?? "").trim() || null;
  const endpoint = (env.AZURE_SPEECH_ENDPOINT ?? "").trim() || null;
  if (!region && !endpoint) return null;
  return { key, region, endpoint };
}

/**
 * The full request URL. `AZURE_SPEECH_ENDPOINT` (the resource host the current docs
 * show) wins when set; otherwise the regional host form is built from
 * `AZURE_SPEECH_REGION`. Never carries the key — auth is a header, so a URL is safe
 * to log if anyone ever does.
 */
export function azurePaUrl(cfg: AzureSpeechConfig): string {
  const base = cfg.endpoint
    ? cfg.endpoint.replace(/\/+$/, "")
    : `https://${cfg.region}.stt.speech.microsoft.com`;
  // The regional host form omits the `/stt` prefix the resource host carries.
  const path = cfg.endpoint ? PA_PATH : PA_PATH.replace(/^\/stt/, "");
  return `${base}${path}?language=${PA_LANGUAGE}&format=detailed`;
}

/**
 * The `Pronunciation-Assessment` parameters for one scripted Italian drill.
 * `Granularity: "Phoneme"` is what buys the per-phoneme scores and the alignment
 * ticks; `NBestPhonemeCount: 5` is what buys the alternates that let the studio say
 * what was produced instead. No `EnableProsodyAssessment` — see the module note.
 */
export function pronunciationAssessmentParams(referenceText: string): Record<string, unknown> {
  return {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: true,
    NBestPhonemeCount: 5,
  };
}

/** The header value: base64 of the assessment JSON. */
export function pronunciationAssessmentHeader(referenceText: string): string {
  return Buffer.from(JSON.stringify(pronunciationAssessmentParams(referenceText)), "utf8").toString("base64");
}

// ---- parsing --------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function numberOr(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

/** Scores live under `PronunciationAssessment` in the detailed response; tolerate the
 *  flattened shape too so a fixture written either way parses identically. */
function assessmentOf(node: Obj): Obj {
  const nested = node.PronunciationAssessment;
  return isObj(nested) ? nested : node;
}

function parseAlternates(raw: unknown): PhonemeAlternate[] {
  if (!Array.isArray(raw)) return [];
  const out: PhonemeAlternate[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const phoneme = typeof item.Phoneme === "string" ? item.Phoneme : null;
    if (!phoneme) continue;
    out.push({ phoneme, score: numberOr(item.Score, 0) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function parsePhoneme(raw: unknown): PronouncedPhoneme | null {
  if (!isObj(raw)) return null;
  const phoneme = typeof raw.Phoneme === "string" ? raw.Phoneme : null;
  if (!phoneme) return null;
  const a = assessmentOf(raw);
  return {
    phoneme,
    accuracyScore: numberOr(a.AccuracyScore, 0),
    offsetTicks: numberOr(raw.Offset, 0),
    durationTicks: numberOr(raw.Duration, 0),
    nBest: parseAlternates(a.NBestPhonemes),
  };
}

function parseWord(raw: unknown): PronouncedWord | null {
  if (!isObj(raw)) return null;
  const word = typeof raw.Word === "string" ? raw.Word : null;
  if (!word) return null;
  const a = assessmentOf(raw);
  const errorType: PronunciationErrorType = isPronunciationErrorType(a.ErrorType) ? a.ErrorType : "None";
  const phonemes = Array.isArray(raw.Phonemes)
    ? raw.Phonemes.map(parsePhoneme).filter((p): p is PronouncedPhoneme => p !== null)
    : [];
  return {
    word,
    accuracyScore: numberOr(a.AccuracyScore, 0),
    errorType,
    offsetTicks: numberOr(raw.Offset, 0),
    durationTicks: numberOr(raw.Duration, 0),
    phonemes,
  };
}

/**
 * Parse a detailed PA response into the adapter boundary's `PronunciationResult`.
 * Throws `PronunciationParseError` for anything we cannot honestly read — including a
 * non-`Success` `RecognitionStatus` (e.g. `NoMatch`: the service heard nothing usable).
 * The caller treats every throw here as CHARGED-BUT-UNREADABLE and finalizes its
 * reservation: Azure answered, so Azure billed, and understating spend is the one
 * thing the money path may never do.
 *
 * Unknown fields are ignored rather than rejected — the response also carries
 * `DisplayText`, `Lexical`, `Confidence` and (en-US only) prosody keys that Italian
 * never sees and this app never uses.
 */
export function parseAzurePaResponse(raw: unknown): PronunciationResult {
  if (!isObj(raw)) throw new PronunciationParseError("Response was not a JSON object.");
  const status = raw.RecognitionStatus;
  if (typeof status === "string" && status !== "Success") {
    throw new PronunciationParseError(`RecognitionStatus was ${status}, not Success.`);
  }
  const nbest = raw.NBest;
  if (!Array.isArray(nbest) || nbest.length === 0 || !isObj(nbest[0])) {
    throw new PronunciationParseError("Response carried no NBest hypothesis.");
  }
  const best = nbest[0];
  const scores = assessmentOf(best);
  const wordsRaw = best.Words;
  if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) {
    throw new PronunciationParseError("Response carried no per-word assessment.");
  }
  const words = wordsRaw.map(parseWord).filter((w): w is PronouncedWord => w !== null);
  if (words.length === 0) throw new PronunciationParseError("No readable word in the assessment.");

  return {
    pronScore: numberOr(scores.PronScore, 0),
    accuracyScore: numberOr(scores.AccuracyScore, 0),
    fluencyScore: numberOr(scores.FluencyScore, 0),
    completenessScore: numberOr(scores.CompletenessScore, 0),
    // `SNR` sits at the TOP level of the response, beside RecognitionStatus — not
    // inside the hypothesis. Null when absent; we never invent one.
    snrDb: typeof raw.SNR === "number" && Number.isFinite(raw.SNR) ? raw.SNR : null,
    words,
  };
}

// ---- the live client ------------------------------------------------------

/** A failure description that can never contain the key (status + shape only). */
function describeFailure(status: number, statusText: string): string {
  return `Azure pronunciation assessment failed: ${status} ${statusText}`.trim();
}

/**
 * The production scorer. Absent `AZURE_SPEECH_*` it reports `isAvailable() === false`
 * and every `score()` throws `PronunciationScorerUnavailableError` — the honest wall.
 * It never returns a fabricated result and never crashes the route.
 */
export const azurePronunciationScorer: PronunciationScorer = {
  id: "azure-pa-it-IT",

  isAvailable(): boolean {
    return azureSpeechConfig() !== null;
  },

  async score({ referenceText, audio }: PronunciationScoreInput): Promise<PronunciationResult> {
    const cfg = azureSpeechConfig();
    if (!cfg) throw new PronunciationScorerUnavailableError("AZURE_SPEECH_KEY is not set.");

    let res: Response;
    try {
      res = await fetch(azurePaUrl(cfg), {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": cfg.key,
          "Content-Type": PA_CONTENT_TYPE,
          Accept: "application/json",
          "Pronunciation-Assessment": pronunciationAssessmentHeader(referenceText),
        },
        body: new Uint8Array(audio),
      });
    } catch (err) {
      // No response: nothing was charged. The caller RELEASES its reservation.
      throw new PronunciationScorerUnavailableError(
        `Network error calling Azure pronunciation assessment: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      // 401/403 (bad or missing key) and 5xx alike: no assessment came back. Azure
      // does not bill a rejected request, so this is the no-charge branch.
      throw new PronunciationScorerUnavailableError(describeFailure(res.status, res.statusText));
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // 200 with an unreadable body: the service ran and billed. CHARGED-but-unreadable.
      throw new PronunciationParseError("Azure returned 200 with an unreadable body.");
    }
    return parseAzurePaResponse(body);
  },
};
