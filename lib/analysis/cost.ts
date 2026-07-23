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
  /**
   * The short-capture full-deep path (E-28, D-20): NO triage and EVERY pending
   * segment deep-listened at native speed. When set, the estimate prices zero mini
   * and 100% deep — the truthful pre-run cost of the path the run will actually
   * take, so what the user sees before running matches what is billed (criterion 4).
   * The route decides this from the session's total speech vs. `deepFullMaxMinutes`.
   */
  fullDeep?: boolean;
}

/**
 * Estimate the USD cost of analyzing `pending` segments. Two paths (D-20):
 *   * cascade (default): the mini over every time-compressed rendition, plus the
 *     expected deep over an assumed fraction (`flagRate`) at native speed.
 *   * full-deep (`fullDeep`): no mini at all, every segment deep-listened at native
 *     speed — the short-capture path, priced at 100% deep.
 * Already-cached segments must be filtered out by the caller — they are billed
 * nothing, so the estimate excludes them exactly as the run never re-bills them.
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

  // Full-deep skips triage entirely and deep-listens 100%; the cascade triages all
  // and deep-listens the assumed flagged fraction.
  const miniUsd = opts.fullDeep ? 0 : renditionMinutes * miniRate;
  const deepUsd = (opts.fullDeep ? 1 : flagRate) * nativeMinutes * deepRate;
  return {
    pendingCount: pending.length,
    miniUsd,
    deepUsd,
    totalUsd: miniUsd + deepUsd,
  };
}
