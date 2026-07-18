import type { Db } from "../db";

// Typed data layer for E-21 contrastive-playback renditions, in the
// lib/segments.ts / lib/analysis/findings.ts style. Server-only. A rendition is
// one rendered correction clip per finding: its on-disk path and the actual TTS
// cost. The `finding_id` PK is the render-once cache key AND the INSERT-first
// double-bill guard — see lib/render/engine.ts. No model calls live here.

export interface Rendition {
  findingId: string;
  path: string;
  costUsd: number;
  createdAt: string;
}

interface RenditionRow {
  finding_id: string;
  path: string;
  cost_usd: number;
  created_at: string;
}

function toRendition(r: RenditionRow): Rendition {
  return { findingId: r.finding_id, path: r.path, costUsd: r.cost_usd, createdAt: r.created_at };
}

/** The rendition for a finding, or null if it has never been rendered. */
export function getRendition(db: Db, findingId: string): Rendition | null {
  const r = db
    .prepare("SELECT finding_id, path, cost_usd, created_at FROM renditions WHERE finding_id = ?")
    .get(findingId) as RenditionRow | undefined;
  return r ? toRendition(r) : null;
}

/**
 * Insert a rendition row idempotently, keyed by `finding_id`. Returns whether THIS
 * call inserted it: `true` means we won the row (record the spend), `false` means a
 * row already existed (a concurrent Generate got there first — bill nothing). The
 * `ON CONFLICT DO NOTHING` on the PK is the double-bill guard; because better-
 * sqlite3 runs transactions serially, two racing generations can never both win.
 */
export function insertRendition(
  db: Db,
  entry: { findingId: string; path: string; costUsd: number },
): boolean {
  const info = db
    .prepare(
      "INSERT INTO renditions (finding_id, path, cost_usd) VALUES (?, ?, ?) ON CONFLICT(finding_id) DO NOTHING",
    )
    .run(entry.findingId, entry.path, entry.costUsd);
  return info.changes > 0;
}

/**
 * The on-disk paths of every rendition belonging to a session's findings — read
 * BEFORE the session (hence its findings and their rendition rows) is deleted, so
 * the delete route can unlink the files the FK cascade leaves behind (E-21
 * criterion 5). No file I/O here; this is the row query only.
 */
export function renditionPathsForSession(db: Db, sessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT r.path AS path
         FROM renditions r JOIN findings f ON f.id = r.finding_id
        WHERE f.session_id = ?`,
    )
    .all(sessionId) as { path: string }[];
  return rows.map((r) => r.path);
}
