import { MINI_MODEL, DEEP_MODELS, assumedFlagRate, callCost, type ModelId } from "./rates";

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

  // Priced PER CALL through the same `callCost` the run itself bills with, rather
  // than by multiplying total minutes against a per-minute rate. Since E-42 a call
  // carries a fixed TEXT cost as well as its audio (criterion 13 — the deep prompt
  // is ~2,600 tokens and is re-sent on every call), so a per-minute-only estimate
  // would under-price a run of many short segments, which is precisely what VAD
  // produces. Segment COUNT is now part of the price, and this is where that shows.
  let miniUsd = 0;
  let deepUsd = 0;
  for (const seg of pending) {
    // Full-deep skips triage entirely and deep-listens 100%; the cascade triages all
    // and deep-listens the assumed flagged fraction.
    if (!opts.fullDeep) miniUsd += callCost(MINI_MODEL, seg.durationMs / opts.tempo);
    deepUsd += (opts.fullDeep ? 1 : flagRate) * callCost(deepModel, seg.durationMs);
  }
  return {
    pendingCount: pending.length,
    miniUsd,
    deepUsd,
    totalUsd: miniUsd + deepUsd,
  };
}
