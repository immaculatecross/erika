import type { PronunciationResult } from "./types";

// The pronunciation-scoring SEAM (E-37, D-21), mirroring `AudioModelClient`
// (lib/analysis/audio-model.ts) and `SpeakerEmbedder` (lib/speaker/embedder.ts): the
// studio depends on this INTERFACE and is threaded a scorer as a PARAMETER — never an
// import of a concrete scorer inside a route, a component, or the orchestration. So
// the whole money path, persistence, view model and knowledge writes are unit-tested
// against a committed fixture scorer, and no CI test ever makes a network call (there
// is no `AZURE_SPEECH_KEY` and no egress in the sandbox).
//
// The boundary is the PARSED result, not the HTTP call (WO criterion 1): everything
// downstream speaks `PronunciationResult`, so swapping the live Azure REST client for
// a fixture changes nothing but the source of the numbers, and OBS-001's key-gated
// live smoke can be added later by driving this same interface with the real impl.

/**
 * The provider could not be reached or is not configured (no `AZURE_SPEECH_KEY`, a
 * network failure, a 4xx around auth). **Nothing was charged** — the caller releases
 * its reservation and shows the honest missing-key wall. A scorer NEVER invents a
 * score in this state.
 */
export class PronunciationScorerUnavailableError extends Error {}

/**
 * The provider ANSWERED — and therefore CHARGED — but the body could not be read as a
 * result (malformed JSON, a missing `NBest`, a non-Success `RecognitionStatus`). The
 * caller must FINALIZE its reservation rather than release it: a resolved call bills
 * even when it is useless to us (the E-16 defect-4 rule, applied to Azure). No score
 * is produced.
 */
export class PronunciationParseError extends Error {}

/** One take to assess against its scripted reference text. */
export interface PronunciationScoreInput {
  /** The exact drill sentence the learner was asked to say (scripted assessment —
   *  never free speech, so D-3 is untouched). */
  referenceText: string;
  /** 16 kHz mono PCM WAV bytes. Azure asks for ≥16 kHz; the caller normalizes. */
  audio: Buffer;
  /** Audio length in seconds — what the call is billed on. */
  seconds: number;
}

export interface PronunciationScorer {
  /** Stable id for provenance; stored on every attempt so a score can always be
   *  traced to what produced it (a fixture take is never mistaken for a real one). */
  readonly id: string;
  /** Whether this scorer can actually run here (credentials present). When false the
   *  studio shows the missing-key wall — never a fabricated score, never a crash. */
  isAvailable(): boolean;
  /** Assess one take. Throws `PronunciationScorerUnavailableError` (no charge) or
   *  `PronunciationParseError` (charged, unreadable); otherwise returns the parsed
   *  result. */
  score(input: PronunciationScoreInput): Promise<PronunciationResult>;
}
