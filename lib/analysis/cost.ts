import { MINI_MODEL, DEEP_MODELS, RATES, assumedFlagRate, type ModelId } from "./rates";

// Pure pre-run cost estimator (D-10). Given the segments a run would actually
// bill for (the *not-yet-cached* ones) it returns a USD figure from the rates
// table — with zero I/O, so it is exhaustively unit-testable and matches the
// hand-computed number. The route and UI show this before a run starts.

/** One pending (not-yet-analyzed) segment's duration, in ms. */
export interface PendingSegment {
  durationMs: number;
}

export interface CostEstimate {
  /** Segments that would be billed (cached ones are excluded upstream). */
  pendingCount: number;
  /** Mini triages every pending segment's time-compressed rendition. */
  miniUsd: number;
  /** Deep-listens an assumed fraction of them at native speed. */
  deepUsd: number;
  totalUsd: number;
}

export interface EstimateOpts {
  /** Triage rendition tempo (rendition ≈ original / tempo). */
  tempo: number;
  /** Assumed flag rate; defaults to the rates-table value. */
  flagRate?: number;
  /** Deep model whose rate the estimate assumes (default: primary). */
  deepModel?: ModelId;
}

/**
 * Estimate the USD cost of analyzing `pending` segments: the mini over every
 * time-compressed rendition, plus the expected deep-listen over an assumed
 * fraction of them at native speed. Already-cached segments must be filtered out
 * by the caller — they are billed nothing.
 */
export function estimateCost(pending: PendingSegment[], opts: EstimateOpts): CostEstimate {
  const flagRate = opts.flagRate ?? assumedFlagRate();
  const deepModel: ModelId = opts.deepModel ?? DEEP_MODELS[0];
  const miniRate = RATES[MINI_MODEL].usdPerAudioMinute;
  const deepRate = RATES[deepModel].usdPerAudioMinute;

  let renditionMinutes = 0;
  let nativeMinutes = 0;
  for (const seg of pending) {
    const minutes = seg.durationMs / 60_000;
    renditionMinutes += minutes / opts.tempo; // mini hears the compressed rendition
    nativeMinutes += minutes; // deep hears the native-speed original
  }

  const miniUsd = renditionMinutes * miniRate;
  const deepUsd = flagRate * nativeMinutes * deepRate;
  return {
    pendingCount: pending.length,
    miniUsd,
    deepUsd,
    totalUsd: miniUsd + deepUsd,
  };
}
