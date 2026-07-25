import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import type { Band } from "../placement/scoring";

// Placement supersession (RETRO-004 §DE-2, v27). The one mechanism that makes a
// placement recoverable, and it does not violate append-only.
//
// THE PROBLEM. A placement writes recognition evidence for every syllabus rule below
// the placed level. A careless run placed at C2 wrote 238 of them, the daily plan
// started serving C2 grammar, and re-taking the check honestly as A1 changed NOTHING:
// `evidence` is append-only by design (the v14 triggers RAISE(ABORT) on UPDATE and
// DELETE — it is the source of truth), the seeder skipped anything already seeded, and
// there was no retraction path. Only deleting the database recovered.
//
// THE MECHANISM. Every placement now records a RUN, and every row it seeds carries
// `source_ref = 'placement:<run id>'`. The evidence READ path (derive.ts `itemEvidence`)
// shows placement rows only from the LATEST run. Nothing is ever rewritten or removed —
// the log still holds every observation ever made, so a re-placed learner's history
// stays auditable — but a superseded run's guesses stop counting as current belief, and
// the derived cache rebuilt from the visible log drops back to `unseen` for rules the
// new placement does not claim. Append-only is preserved *exactly*: the only writes are
// INSERTs.
//
// This is deliberately NOT "write compensating negative evidence". A polarity-0
// recognition row would be a claim the learner got something WRONG, which is not what
// happened — the earlier estimate was withdrawn, not disproved — and it would leak into
// `deriveStatus`'s lapse logic as if it were an observation about the learner. A
// superseded guess should become invisible, not become a black mark.
//
// Ordering is by `seq` (AUTOINCREMENT), never `created_at`: `datetime('now')` is
// second-granular, so two placements inside one second tie and "the latest run" — the
// whole basis of supersession — would be arbitrary.

/** The `evidence.source_ref` value a run's seeded rows carry. */
export function placementSeedRef(runId: string): string {
  return `placement:${runId}`;
}

export interface PlacementRun {
  id: string;
  seq: number;
  level: Band | null;
  calibrated: boolean;
  falseAlarmRate: number | null;
  createdAt: string;
}

interface RunRow {
  seq: number;
  id: string;
  level: string | null;
  calibrated: number;
  false_alarm_rate: number | null;
  created_at: string;
}

function toRun(r: RunRow): PlacementRun {
  return {
    id: r.id,
    seq: r.seq,
    level: (r.level as Band | null) ?? null,
    calibrated: r.calibrated === 1,
    falseAlarmRate: r.false_alarm_rate,
    createdAt: r.created_at,
  };
}

/**
 * Record a completed placement and return its run id. Recording it is what makes it
 * CURRENT: from this insert on, every earlier run's seeded evidence is superseded — so
 * the caller records the run BEFORE seeding, then re-derives the items the previous run
 * had touched (see `seedPlacement`).
 */
export function recordPlacementRun(
  db: Db,
  input: { level: Band | null; calibrated: boolean; falseAlarmRate: number | null },
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO placement_runs (id, level, calibrated, false_alarm_rate) VALUES (?, ?, ?, ?)",
  ).run(id, input.level, input.calibrated ? 1 : 0, input.falseAlarmRate);
  return id;
}

/** The run whose seeded evidence counts, or null when no placement has ever run. */
export function currentPlacementRun(db: Db): PlacementRun | null {
  const r = db
    .prepare("SELECT seq, id, level, calibrated, false_alarm_rate, created_at FROM placement_runs ORDER BY seq DESC LIMIT 1")
    .get() as RunRow | undefined;
  return r ? toRun(r) : null;
}

/** Every placement run, oldest first — the audit trail behind a re-placement. */
export function listPlacementRuns(db: Db): PlacementRun[] {
  const rows = db
    .prepare("SELECT seq, id, level, calibrated, false_alarm_rate, created_at FROM placement_runs ORDER BY seq")
    .all() as RunRow[];
  return rows.map(toRun);
}

/**
 * The SQL predicate that hides superseded placement evidence, for use in a WHERE
 * clause over an `evidence` row aliased as `e`. Every read that derives belief from
 * the log must apply it (there is exactly one such read: derive.ts `itemEvidence`).
 *
 * Non-placement evidence is never touched. A placement row survives only if it belongs
 * to the latest run — or if no run has ever been recorded, which is the pre-v27 case:
 * a database placed before this migration has rows with a NULL `source_ref`, and they
 * stay authoritative until the learner takes the check again, at which point the new
 * run supersedes them like any other. That is precisely the repair §DE-2 asked for.
 */
export const VISIBLE_PLACEMENT_EVIDENCE = `(
  e.source <> 'placement'
  OR NOT EXISTS (SELECT 1 FROM placement_runs)
  OR e.source_ref = (SELECT 'placement:' || id FROM placement_runs ORDER BY seq DESC LIMIT 1)
)`;
