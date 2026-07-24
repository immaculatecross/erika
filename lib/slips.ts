import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { Category } from "./analysis/findings";
import type { Grade } from "./srs";
import { INCLUDED_FINDING_SCOPE, listAnalysedSessions, listIncludedFindingsWithSession } from "./findings-model";

// E-20 Slips, the fossil dossier. The founding sentence's fourth clause — "stop
// making them" — becomes real: findings cluster into persistent *slips* (one
// recurring mistake = one slip) with a stable key, and each slip's state is
// COMPUTED (never stored) from later analysed sessions. Green finally means
// mastery. No model calls, ever.
//
// This file splits like lib/focus.ts: the top half is a PURE core (clustering,
// state, copy, timeline order) unit-tested against hand-built fixtures; the bottom
// half is the thin DB glue that feeds it through the canonical read-model
// (lib/findings-model.ts) — so what counts as an analysed session, and how a
// halted or failed run is treated, is defined there once and never re-litigated.
// Only `import type` reaches the client pages, so no better-sqlite3 leaks into a
// bundle (the view interfaces below are the shared shape).

export type { Category } from "./analysis/findings";

// The active/remission/resolved state machine and its status copy live in
// lib/slip-standing.ts (pure, client-safe, under the 500-line hook); re-exported
// here so every `@/lib/slips` import is unchanged.
export {
  RESOLVED_CLEAN_SESSIONS,
  computeSlipStanding,
  shortDate,
  statusLine,
  type SlipState,
  type SlipStanding,
} from "./slip-standing";
import { computeSlipStanding, statusLine } from "./slip-standing";
import type { SlipState, SlipStanding } from "./slip-standing";

// ── pure core ────────────────────────────────────────────────────────────────

/** One finding, reduced to what clustering needs. */
export interface SlipFinding {
  id: string;
  category: Category;
  correction: string;
  /** The v10 recurrence link: the CLIPPED (≤60-char) correction of an earlier
   *  habit the deep model marked this finding as recurring, or null. */
  recurrenceOf: string | null;
}

/** A cluster of findings that are the same recurring mistake. */
export interface SlipCluster {
  /** Deterministic, re-analysis-stable: `category:<normalized representative>`. */
  key: string;
  category: Category;
  /** The representative (longest, hence least-clipped) correction, original case. */
  correction: string;
  /** The clustered finding ids, sorted for a stable identity. */
  findingIds: string[];
}

/**
 * Normalize a correction for clustering: lower-cased, whitespace-collapsed, and
 * stripped of a trailing ellipsis or punctuation. The ellipsis strip matters — a
 * `recurrence_of` value is the profile's CLIPPED correction (`…` appended,
 * lib/analysis/profile.ts), so a clipped link is a PREFIX of the full correction
 * it points at, never an equal string. Clustering prefix-matches on this form.
 */
export function normalizeCorrection(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[…]+/g, "")
    .replace(/\.\.\.+$/g, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cluster findings into slips by normalized correction + category, folding in the
 * `recurrence_of` links. Deterministic: the same finding set always yields the
 * same clusters and the same keys, so a slip survives re-analysis.
 *
 * Three merges, via union-find over the finding indices:
 *   1. same category + byte-equal normalized correction (the common case);
 *   2. a `recurrence_of` link — the clipped correction is prefix-matched to the
 *      fullest correction in its category and the two are merged, so a >60-char
 *      correction and a finding that recurs it (carrying only its 59-char clip)
 *      land in one slip even though their strings are never equal;
 *   3. the cluster's representative is the LONGEST normalized correction (clips
 *      are always shorter prefixes), ties broken lexicographically — so the key
 *      and the shown correction are the fullest phrasing, deterministically.
 */
export function clusterFindings(findings: readonly SlipFinding[]): SlipCluster[] {
  const parent = findings.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] = parent[parent[r]];
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const norm = findings.map((f) => normalizeCorrection(f.correction));

  // 1. exact-equality merge within a category.
  const firstOf = new Map<string, number>();
  findings.forEach((f, i) => {
    const k = `${f.category}::${norm[i]}`;
    const prev = firstOf.get(k);
    if (prev === undefined) firstOf.set(k, i);
    else union(prev, i);
  });

  // 2. recurrence_of prefix folding: attach the clipped link to the fullest
  //    correction in the same category that it is a prefix of.
  findings.forEach((f, i) => {
    if (!f.recurrenceOf) return;
    const r = normalizeCorrection(f.recurrenceOf);
    if (r === "") return;
    let target = -1;
    let targetNorm = "";
    findings.forEach((g, j) => {
      if (g.category !== f.category) return;
      const nj = norm[j];
      if (nj !== r && !nj.startsWith(r)) return;
      // Prefer the shortest superstring (closest match); ties lexicographic.
      if (target === -1 || nj.length < targetNorm.length || (nj.length === targetNorm.length && nj < targetNorm)) {
        target = j;
        targetNorm = nj;
      }
    });
    if (target >= 0) union(i, target);
  });

  // 3. build the clusters.
  const groups = new Map<number, number[]>();
  findings.forEach((_, i) => {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(i);
    else groups.set(root, [i]);
  });

  const clusters: SlipCluster[] = [];
  for (const idxs of groups.values()) {
    let rep = idxs[0];
    for (const i of idxs) {
      if (norm[i].length > norm[rep].length || (norm[i].length === norm[rep].length && norm[i] < norm[rep])) {
        rep = i;
      }
    }
    clusters.push({
      key: `${findings[rep].category}:${norm[rep]}`,
      category: findings[rep].category,
      correction: findings[rep].correction.trim(),
      findingIds: idxs.map((i) => findings[i].id).sort(),
    });
  }
  clusters.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return clusters;
}

/** One row on a slip's dossier timeline — an occurrence, a card, or a mastery mark. */
export type DossierItem =
  | {
      kind: "occurrence";
      at: string;
      findingId: string;
      quote: string;
      correction: string;
      sessionId: string;
      startMs: number;
      sessionFilename: string;
    }
  | { kind: "card"; at: string; grade: Grade | null; repetitions: number; due: string }
  | { kind: "mastery"; at: string; category: Category; mastery: number };

const KIND_ORDER: Record<DossierItem["kind"], number> = { occurrence: 0, card: 1, mastery: 2 };

/** Interleave every event onto one chronological timeline; ties keep occurrences
 *  before their drill, then mastery. Pure — the DB glue only gathers the rows. */
export function buildTimeline(items: readonly DossierItem[]): DossierItem[] {
  return [...items].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

// ── view shapes (client-safe) ────────────────────────────────────────────────

/** One slip on the index. */
export interface SlipSummary {
  id: string;
  category: Category;
  correction: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  standing: SlipStanding;
  statusLine: string;
}

/** The slips index payload — every slip plus the counts Focus surfaces. */
export interface SlipsIndex {
  slips: SlipSummary[];
  resolvedCount: number;
  remissionCount: number;
  activeCount: number;
}

/** A single slip's dossier — its standing and its whole interleaved timeline. */
export interface SlipDossier {
  id: string;
  category: Category;
  correction: string;
  occurrences: number;
  standing: SlipStanding;
  statusLine: string;
  timeline: DossierItem[];
}

// ── DB glue ──────────────────────────────────────────────────────────────────

/** Read every included finding as a clustering input, through the canonical model. */
function collectSlipFindings(db: Db): SlipFinding[] {
  return listIncludedFindingsWithSession(db).map((f) => ({
    id: f.id,
    category: f.category,
    correction: f.correction,
    recurrenceOf: f.recurrenceOf ?? null,
  }));
}

/** The `created_at` of every analysed session, oldest first (findings-model scope). */
function analysedSessionDates(db: Db): string[] {
  return listAnalysedSessions(db).map((s) => s.createdAt);
}

// [RETRO-002 P3] A slip's green (remission/resolved) requires a positive
// production/drill event, not mere absence of recurrence. The event today is a
// PASSING card grade (`good`/`easy`) on one of the slip's findings — the user
// confronted the correction and reproduced it correctly. (`again` is a lapse and
// never counts.) Spontaneous re-use in a later recording will also count once the
// knowledge core links slips to items; until then the drill is the signal.

/** Slip ids that carry ≥1 passing drill grade on one of their findings. */
function positiveEventSlipIds(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT fs.slip_id AS slip_id
         FROM finding_slips fs
         JOIN cards c ON c.finding_id = fs.finding_id
        WHERE c.last_grade IN ('good','easy')`,
    )
    .all() as { slip_id: string }[];
  return new Set(rows.map((r) => r.slip_id));
}

/** Finding ids that carry a passing drill grade — the cluster-keyed form of the
 *  positive-event signal, for the pure-clustering `resolvedSlipCount`. */
function positiveDrillFindingIds(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT DISTINCT finding_id FROM cards WHERE last_grade IN ('good','easy')")
    .all() as { finding_id: string }[];
  return new Set(rows.map((r) => r.finding_id));
}

/**
 * Materialize the clustering: upsert one `slips` row per cluster (keyed by the
 * deterministic `slip_key`, so a re-analysis of the same findings keeps the same
 * id) and rewrite the finding→slip association. Idempotent and model-call-free.
 * Called by the read routes before they read, the way card generation is.
 */
export function materializeSlips(db: Db): void {
  const clusters = clusterFindings(collectSlipFindings(db));
  const upsertSlip = db.prepare(
    `INSERT INTO slips (id, slip_key, category, correction)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(slip_key) DO UPDATE SET category = excluded.category, correction = excluded.correction`,
  );
  const idOf = db.prepare("SELECT id FROM slips WHERE slip_key = ?");
  const assoc = db.prepare(
    `INSERT INTO finding_slips (finding_id, slip_id) VALUES (?, ?)
     ON CONFLICT(finding_id) DO UPDATE SET slip_id = excluded.slip_id`,
  );
  db.transaction(() => {
    for (const c of clusters) {
      upsertSlip.run(randomUUID(), c.key, c.category, c.correction);
      const slipId = (idOf.get(c.key) as { id: string }).id;
      for (const fid of c.findingIds) assoc.run(fid, slipId);
    }
  })();
}

interface SlipAggRow {
  id: string;
  category: Category;
  correction: string;
  n: number;
  first_at: string;
  last_at: string;
}

/**
 * Every slip that currently has ≥1 included finding, with its occurrence span —
 * ONE `GROUP BY` aggregate, never a query per session (E-20 criterion 5). Assumes
 * `materializeSlips` has run; a slip whose findings were all deleted drops out
 * because the join finds none. Standings are computed in memory from the shared
 * analysed-session dates, so the whole index is a constant number of queries.
 */
export function listSlips(db: Db): SlipSummary[] {
  const dates = analysedSessionDates(db);
  const positive = positiveEventSlipIds(db);
  const rows = db
    .prepare(
      `SELECT sl.id AS id, sl.category AS category, sl.correction AS correction,
              COUNT(*) AS n, MIN(s.created_at) AS first_at, MAX(s.created_at) AS last_at
         FROM slips sl
         JOIN finding_slips fs ON fs.slip_id = sl.id
         JOIN findings f ON f.id = fs.finding_id
         JOIN sessions s ON s.id = f.session_id
        WHERE ${INCLUDED_FINDING_SCOPE}
        GROUP BY sl.id`,
    )
    .all() as SlipAggRow[];

  const summaries = rows.map((r): SlipSummary => {
    const standing = computeSlipStanding(r.last_at, dates, positive.has(r.id));
    return {
      id: r.id,
      category: r.category,
      correction: r.correction,
      occurrences: r.n,
      firstSeenAt: r.first_at,
      lastSeenAt: r.last_at,
      standing,
      statusLine: statusLine(standing),
    };
  });

  // Active first (the work), then remission, then resolved; recent first within.
  const rank: Record<SlipState, number> = { active: 0, remission: 1, resolved: 2 };
  summaries.sort(
    (a, b) =>
      rank[a.standing.state] - rank[b.standing.state] ||
      (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
  return summaries;
}

/** The full index payload the /slips screen and Focus's resolved count read. */
export function buildSlipsIndex(db: Db): SlipsIndex {
  materializeSlips(db);
  const slips = listSlips(db);
  return {
    slips,
    resolvedCount: slips.filter((s) => s.standing.state === "resolved").length,
    remissionCount: slips.filter((s) => s.standing.state === "remission").length,
    activeCount: slips.filter((s) => s.standing.state === "active").length,
  };
}

/**
 * How many slips are currently resolved — the one number Focus attaches green to
 * (D-14). Read-only: it does NOT persist (Focus is a GET that should not write),
 * computing the same deterministic clustering in memory. The slips index owns
 * materialization; this and it always agree because the clustering is pure.
 */
export function resolvedSlipCount(db: Db): number {
  const clusters = clusterFindings(collectSlipFindings(db));
  const dates = analysedSessionDates(db);
  const drilled = positiveDrillFindingIds(db);
  const findingSession = new Map<string, string>();
  for (const f of listIncludedFindingsWithSession(db)) findingSession.set(f.id, f.sessionCreatedAt);
  let resolved = 0;
  for (const c of clusters) {
    let lastAt = "";
    for (const fid of c.findingIds) {
      const at = findingSession.get(fid);
      if (at && at > lastAt) lastAt = at;
    }
    const hasPositive = c.findingIds.some((fid) => drilled.has(fid));
    if (lastAt && computeSlipStanding(lastAt, dates, hasPositive).state === "resolved") resolved++;
  }
  return resolved;
}

interface OccurrenceRow {
  finding_id: string;
  quote: string;
  correction: string;
  session_id: string;
  start_ms: number;
  at: string;
  fname: string;
}

/**
 * One slip's dossier: every occurrence (quote, session date, and the `?t=` deep
 * link data for jump-to-audio) interleaved with its drill history — the SM-2 card
 * state for its findings and the lesson mastery for its category — on one
 * chronological timeline. Returns null when the slip id is unknown or now empty.
 */
export function getSlipDossier(db: Db, id: string): SlipDossier | null {
  const slip = db.prepare("SELECT id, category, correction FROM slips WHERE id = ?").get(id) as
    | { id: string; category: Category; correction: string }
    | undefined;
  if (!slip) return null;

  const occRows = db
    .prepare(
      `SELECT f.id AS finding_id, f.quote AS quote, f.correction AS correction,
              f.session_id AS session_id, f.start_ms AS start_ms,
              s.created_at AS at, s.original_filename AS fname
         FROM finding_slips fs
         JOIN findings f ON f.id = fs.finding_id
         JOIN sessions s ON s.id = f.session_id
        WHERE fs.slip_id = ? AND ${INCLUDED_FINDING_SCOPE}
        ORDER BY s.created_at, f.start_ms, f.id`,
    )
    .all(id) as OccurrenceRow[];
  if (occRows.length === 0) return null;

  const items: DossierItem[] = occRows.map((r) => ({
    kind: "occurrence",
    at: r.at,
    findingId: r.finding_id,
    quote: r.quote,
    correction: r.correction,
    sessionId: r.session_id,
    startMs: r.start_ms,
    sessionFilename: r.fname,
  }));

  // Drill: the SM-2 card of each finding in the slip (its grade, streak, next due).
  const cardRows = db
    .prepare(
      `SELECT c.created_at AS at, c.last_grade AS grade, c.repetitions AS repetitions, c.due AS due
         FROM cards c
         JOIN finding_slips fs ON fs.finding_id = c.finding_id
        WHERE fs.slip_id = ?
        ORDER BY c.created_at`,
    )
    .all(id) as { at: string; grade: Grade | null; repetitions: number; due: string }[];
  for (const c of cardRows) {
    items.push({ kind: "card", at: c.at, grade: c.grade, repetitions: c.repetitions, due: c.due });
  }

  // Drill: lesson mastery for the slip's category (patterns are per-category, E-6).
  const mastery = db
    .prepare("SELECT mastery, updated_at FROM lesson_mastery WHERE pattern_key = ?")
    .get(`category:${slip.category}`) as { mastery: number; updated_at: string } | undefined;
  if (mastery) {
    items.push({ kind: "mastery", at: mastery.updated_at, category: slip.category, mastery: mastery.mastery });
  }

  const dates = analysedSessionDates(db);
  const lastAt = occRows[occRows.length - 1].at;
  const hasPositive = positiveEventSlipIds(db).has(id);
  const standing = computeSlipStanding(lastAt, dates, hasPositive);
  return {
    id: slip.id,
    category: slip.category,
    correction: slip.correction,
    occurrences: occRows.length,
    standing,
    statusLine: statusLine(standing),
    timeline: buildTimeline(items),
  };
}
