import { azurePronunciationScorer } from "./azure";
import type { PronunciationScorer } from "./scorer";

// The pronunciation studio's public surface (E-37). The concrete scorer is resolved
// HERE and INJECTED into the orchestration by the route — exactly as scripts/worker.ts
// resolves the real audio model / speaker embedder and passes them in, keeping the
// orchestration itself free of any concrete-scorer import (the seam, WO criterion 1).

export type { PronunciationScorer, PronunciationScoreInput } from "./scorer";
export { PronunciationParseError, PronunciationScorerUnavailableError } from "./scorer";
export * from "./types";
export {
  pronunciationThresholds,
  scoreBand,
  isTooNoisy,
  UNCALIBRATED_NOTICE,
  TOO_NOISY_NOTICE,
  DEFAULT_PRONUNCIATION_THRESHOLDS,
  type PronunciationThresholds,
  type ScoreBand,
} from "./thresholds";
export {
  listPronunciationDrills,
  resolveDrill,
  pronunciationDrill,
  isPronunciationFinding,
  drillKeyForFinding,
  drillKeyOf,
  parseDrillKey,
  findingDrillSource,
  DRILL_SOURCES,
  type PronunciationDrill,
  type DrillSource,
} from "./drills";
export { whatToListenFor, UNSCORED_NOTICE, type DrillGuidance } from "./guidance";
export { buildResultView, attemptPassed, type ResultView, type WordCell, type PhonemeCell } from "./view";
export { buildStudioView, phoneSymbolOf, type StudioView } from "./studio-view";
export {
  scoreAttempt,
  drillEstimateUsd,
  DrillTooLongError,
  ScorerUnavailableError,
  BudgetExceededError,
} from "./studio";
export {
  getAttempt,
  listAttemptsForDrill,
  latestScorableAttempt,
  type PronunciationAttempt,
} from "./attempts";
export { estimatePronunciationUsd, pronunciationLeaseHash } from "./money";

/**
 * The scorer this server can actually use. There is exactly one implementation — the
 * live Azure REST client — and it reports `isAvailable() === false` when no
 * `AZURE_SPEECH_*` credentials are set, which is what drives the honest missing-key
 * wall. There is deliberately NO fallback scorer: a fabricated score would be worse
 * than no score (D-19). The committed fixtures drive TESTS only and are never resolved
 * here (lib/pronunciation/fixture-scorer.ts).
 */
export function resolvePronunciationScorer(): PronunciationScorer {
  return azurePronunciationScorer;
}
