import type { Db } from "../db";
import type { PronunciationResult } from "./types";

// The `pronunciation_attempts` store (E-37, migration v24). One row per SCORED take:
// the drill, the learner's audio, the whole parsed result, the headline scores, the
// SNR verdict, and the actual charge. Typed data layer only — no money, no model
// calls, no policy; the orchestration in ./studio.ts owns those.

export interface PronunciationAttempt {
  id: string;
  /** Stable key for the drill this take belongs to (`finding:<id>` today). */
  drillKey: string;
  findingId: string | null;
  referenceText: string;
  audioPath: string;
  audioSeconds: number;
  result: PronunciationResult;
  pronScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  snrDb: number | null;
  /** True when the take was too noisy to score honestly — the scores are stored (the
   *  call was billed) but must never be presented as a measurement of the learner. */
  lowSnr: boolean;
  /** Which scorer produced this — a fixture-sourced score is never mistaken for a
   *  real one. */
  scorerId: string;
  costUsd: number;
  createdAt: string;
}

interface AttemptRow {
  id: string;
  drill_key: string;
  finding_id: string | null;
  reference_text: string;
  audio_path: string;
  audio_seconds: number;
  result: string;
  pron_score: number;
  accuracy_score: number;
  fluency_score: number;
  completeness_score: number;
  snr_db: number | null;
  low_snr: number;
  scorer_id: string;
  cost_usd: number;
  created_at: string;
}

function toAttempt(r: AttemptRow): PronunciationAttempt {
  return {
    id: r.id,
    drillKey: r.drill_key,
    findingId: r.finding_id,
    referenceText: r.reference_text,
    audioPath: r.audio_path,
    audioSeconds: r.audio_seconds,
    result: JSON.parse(r.result) as PronunciationResult,
    pronScore: r.pron_score,
    accuracyScore: r.accuracy_score,
    fluencyScore: r.fluency_score,
    completenessScore: r.completeness_score,
    snrDb: r.snr_db,
    lowSnr: !!r.low_snr,
    scorerId: r.scorer_id,
    costUsd: r.cost_usd,
    createdAt: r.created_at,
  };
}

export interface NewPronunciationAttempt {
  id: string;
  drillKey: string;
  findingId: string | null;
  referenceText: string;
  audioPath: string;
  audioSeconds: number;
  result: PronunciationResult;
  lowSnr: boolean;
  scorerId: string;
  costUsd: number;
}

/** Insert one scored attempt. The headline scores are projected out of the parsed
 *  result rather than taken on trust, so a column can never disagree with the JSON. */
export function insertAttempt(db: Db, a: NewPronunciationAttempt): void {
  db.prepare(
    `INSERT INTO pronunciation_attempts
       (id, drill_key, finding_id, reference_text, audio_path, audio_seconds, result,
        pron_score, accuracy_score, fluency_score, completeness_score, snr_db, low_snr,
        scorer_id, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id,
    a.drillKey,
    a.findingId,
    a.referenceText,
    a.audioPath,
    a.audioSeconds,
    JSON.stringify(a.result),
    a.result.pronScore,
    a.result.accuracyScore,
    a.result.fluencyScore,
    a.result.completenessScore,
    a.result.snrDb,
    a.lowSnr ? 1 : 0,
    a.scorerId,
    a.costUsd,
  );
}

export function getAttempt(db: Db, id: string): PronunciationAttempt | null {
  const r = db.prepare("SELECT * FROM pronunciation_attempts WHERE id = ?").get(id) as AttemptRow | undefined;
  return r ? toAttempt(r) : null;
}

/** Every attempt at one drill, newest first — the re-attempt history. */
export function listAttemptsForDrill(db: Db, drillKey: string, limit = 20): PronunciationAttempt[] {
  const rows = db
    .prepare(
      "SELECT * FROM pronunciation_attempts WHERE drill_key = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(drillKey, limit) as AttemptRow[];
  return rows.map(toAttempt);
}

/** The most recent SCORABLE attempt at a drill (a too-noisy take is not one), or
 *  null. Drives "your last take" without ever surfacing an unhearable score. */
export function latestScorableAttempt(db: Db, drillKey: string): PronunciationAttempt | null {
  const r = db
    .prepare(
      "SELECT * FROM pronunciation_attempts WHERE drill_key = ? AND low_snr = 0 ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(drillKey) as AttemptRow | undefined;
  return r ? toAttempt(r) : null;
}

/** How many attempts exist per drill key — the studio list's quiet history column. */
export function attemptCountsByDrill(db: Db): Map<string, number> {
  const rows = db
    .prepare("SELECT drill_key, COUNT(*) AS n FROM pronunciation_attempts GROUP BY drill_key")
    .all() as { drill_key: string; n: number }[];
  return new Map(rows.map((r) => [r.drill_key, r.n]));
}
