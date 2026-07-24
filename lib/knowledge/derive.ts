import {
  fsrs,
  createEmptyCard,
  dateDiffInDays,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade as FsrsGrade,
} from "ts-fsrs";
import type { Db } from "../db";
import { isAudioDerived, type Evidence, type EvidenceMode, type KnowledgeStatus } from "./types";
import type { Grade } from "../srs";

// Deriving per-item knowledge state from the evidence log (E-25, D-19). This is
// the whole point of the append-only design: `srs_stability`, `srs_difficulty`,
// `srs_last_event_at` and `status` on `knowledge_items` are a DISPOSABLE CACHE —
// `deriveItemState` folds an item's ordered evidence into them, and it is the
// single function both the incremental write path (lib/knowledge/evidence.ts, which
// re-folds the whole history after each append) and the full rebuild use, so the
// cache is identical however it was produced (criterion 6). No source of truth
// lives here; wipe the columns and this rebuilds them exactly.
//
// FSRS uses the real elapsed time between evidence rows (what SM-2 could not), so
// the fold reads each row's `created_at`. Recognition-mode evidence is too weak to
// be an FSRS review (D-19): it moves `status` but never touches the S/D/last-event
// triple. Grade mapping (spike-2): incorrect → Again; correct+cued → Good;
// correct+spontaneous → Easy.

const engine: FSRS = fsrs({ enable_short_term: false });

/** The FSRS grade an evidence row maps to, or null when it is not a review
 *  (recognition-mode evidence updates status only). */
export function evidenceToGrade(polarity: 0 | 1, mode: EvidenceMode): Grade | null {
  if (mode === "recognition") return null;
  if (polarity === 0) return "again";
  return mode === "cued" ? "good" : "easy";
}

const RATING: Record<Grade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** SQLite UTC text ("YYYY-MM-DD HH:MM:SS") → Date. */
function toDate(sqliteTs: string): Date {
  return new Date(sqliteTs.replace(" ", "T") + "Z");
}

/** The calendar day (UTC) an evidence row falls on — the "distinct days" key. */
function dayOf(sqliteTs: string): string {
  return sqliteTs.slice(0, 10);
}

export interface DerivedState {
  srsStability: number | null;
  srsDifficulty: number | null;
  srsLastEventAt: string | null;
  status: KnowledgeStatus;
  /** True once the user produced this lemma CORRECTLY in a recording (E-28, D-19):
   *  a spontaneous, audio-derived, finding-sourced positive evidence row exists. A
   *  DERIVED flag — rebuilt from the evidence log like the rest of this cache — that
   *  the future daily composer (E-31) reads to EXCLUDE recording-attested lemmas from
   *  new-item selection. Persisted on `knowledge_items.recording_attested`. */
  recordingAttested: boolean;
}

/**
 * Whether the evidence log attests this item was PRODUCED CORRECTLY in a recording
 * (E-28): at least one positive, spontaneous, audio-derived, finding-sourced row.
 * That combination is exactly what `recordProducedLemmas` writes and what a produced
 * lemma means — distinct from a cued review (not spontaneous) or a typed exercise
 * (not audio-derived) or an error finding (polarity 0).
 */
export function deriveRecordingAttested(evidence: Evidence[]): boolean {
  return evidence.some(
    (e) =>
      e.source === "finding" &&
      e.polarity === 1 &&
      e.mode === "spontaneous" &&
      isAudioDerived(e.mode, e.weight),
  );
}

/**
 * Fold an item's evidence (ascending `created_at`, ties by `id`) into its derived
 * state. Pure — same input, same output. FSRS state comes from the review-grade
 * events only; `status` from the full D-19 gate below.
 */
export function deriveItemState(evidence: Evidence[]): DerivedState {
  if (evidence.length === 0) {
    return { srsStability: null, srsDifficulty: null, srsLastEventAt: null, status: "unseen", recordingAttested: false };
  }

  // FSRS fold over the review-grade events, in real elapsed time.
  let stability: number | null = null;
  let difficulty: number | null = null;
  let lastReview: Date | null = null;
  let lastEventAt: string | null = null;
  let reps = 0;
  let lapses = 0;

  for (const ev of evidence) {
    const grade = evidenceToGrade(ev.polarity, ev.mode);
    if (grade === null) continue; // recognition: status only, no FSRS update
    const at = toDate(ev.createdAt);
    let card: FsrsCard;
    if (stability === null || lastReview === null) {
      card = createEmptyCard(at);
    } else {
      card = {
        due: lastReview,
        stability,
        difficulty,
        elapsed_days: dateDiffInDays(lastReview, at),
        scheduled_days: 0,
        learning_steps: 0,
        reps,
        lapses,
        state: State.Review,
        last_review: lastReview,
      } as FsrsCard;
    }
    const next = engine.next(card, at, RATING[grade]).card;
    stability = next.stability;
    difficulty = next.difficulty;
    lastReview = at;
    lastEventAt = ev.createdAt;
    reps += 1;
    if (grade === "again") lapses += 1;
  }

  return {
    srsStability: stability,
    srsDifficulty: difficulty,
    srsLastEventAt: lastEventAt,
    status: deriveStatus(evidence),
    recordingAttested: deriveRecordingAttested(evidence),
  };
}

/**
 * The status ladder (D-19). `known` demands corroboration — one noisy
 * audio-positive can never reach it alone:
 *   ≥2 correct events on ≥2 distinct days, ≥1 spontaneous, at least one NOT
 *   audio-derived, and no incorrect event since the last correct one.
 * Below that: `lapsed` if a review failed after a correct one, else `learning`
 * once any real review exists, else `introduced` (seen, only recognition so far).
 */
export function deriveStatus(evidence: Evidence[]): KnowledgeStatus {
  if (evidence.length === 0) return "unseen";

  const correct = evidence.filter((e) => e.polarity === 1);
  const distinctCorrectDays = new Set(correct.map((e) => dayOf(e.createdAt))).size;
  const hasSpontaneousCorrect = correct.some((e) => e.mode === "spontaneous");
  const hasNonAudioCorrect = correct.some((e) => !isAudioDerived(e.mode, e.weight));
  const lastCorrectAt = correct.length ? correct[correct.length - 1].createdAt : null;
  const incorrectSinceLastCorrect =
    lastCorrectAt !== null && evidence.some((e) => e.polarity === 0 && e.createdAt > lastCorrectAt);

  const known =
    correct.length >= 2 &&
    distinctCorrectDays >= 2 &&
    hasSpontaneousCorrect &&
    hasNonAudioCorrect &&
    !incorrectSinceLastCorrect;
  if (known) return "known";

  // Reviews are the non-recognition events (the ones FSRS acted on).
  const reviews = evidence.filter((e) => evidenceToGrade(e.polarity, e.mode) !== null);
  const firstCorrectReviewAt = reviews.find((e) => e.polarity === 1)?.createdAt ?? null;
  const lapsed =
    firstCorrectReviewAt !== null &&
    reviews.some((e) => e.polarity === 0 && e.createdAt > firstCorrectReviewAt);
  if (lapsed) return "lapsed";

  return reviews.length > 0 ? "learning" : "introduced";
}

interface EvidenceRow {
  id: string;
  item_id: string;
  source: Evidence["source"];
  source_ref: string | null;
  polarity: 0 | 1;
  mode: EvidenceMode;
  weight: number;
  session_id: string | null;
  created_at: string;
}

function toEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id,
    itemId: r.item_id,
    source: r.source,
    sourceRef: r.source_ref,
    polarity: r.polarity,
    mode: r.mode,
    weight: r.weight,
    sessionId: r.session_id,
    createdAt: r.created_at,
  };
}

/** One item's evidence in the canonical fold order (`created_at`, then `id`). */
export function itemEvidence(db: Db, itemId: string): Evidence[] {
  const rows = db
    .prepare("SELECT * FROM evidence WHERE item_id = ? ORDER BY created_at, id")
    .all(itemId) as EvidenceRow[];
  return rows.map(toEvidence);
}

/** Write a derived state onto an item's cache columns (idempotent overwrite). */
export function writeDerived(db: Db, itemId: string, s: DerivedState): void {
  db.prepare(
    `UPDATE knowledge_items
        SET srs_stability = ?, srs_difficulty = ?, srs_last_event_at = ?, status = ?, recording_attested = ?
      WHERE id = ?`,
  ).run(s.srsStability, s.srsDifficulty, s.srsLastEventAt, s.status, s.recordingAttested ? 1 : 0, itemId);
}

/** Re-derive one item's cache from its evidence (the incremental maintenance step). */
export function rebuildItem(db: Db, itemId: string): void {
  writeDerived(db, itemId, deriveItemState(itemEvidence(db, itemId)));
}

/**
 * Rebuild every item's derived cache from the evidence log alone. Proves the cache
 * is disposable (criterion 6): callable after wiping the `srs_*`/`status` columns to
 * restore them identically. Returns the number of items rebuilt.
 */
export function rebuildAllDerived(db: Db): number {
  const ids = (db.prepare("SELECT id FROM knowledge_items").all() as { id: string }[]).map((r) => r.id);
  const tx = db.transaction(() => {
    for (const id of ids) rebuildItem(db, id);
  });
  tx();
  return ids.length;
}
