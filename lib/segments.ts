import { randomUUID } from "node:crypto";
import type { Db } from "./db";

// Typed data layer for extracted speech segments (E-3), mirroring lib/settings.ts
// and lib/sessions.ts. A segment is one kept speech interval: its original-
// timeline timestamps, an ordered per-session index, and a SHA-256 content hash
// that is the dedup/cache key. Server-only.

export interface Segment {
  id: string;
  sessionId: string;
  idx: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  contentHash: string;
  /** Max cosine over the segment's speaker windows (E-36), or null if unattributed. */
  speakerScore: number | null;
  /** 1 = the enrolled user, 0 = another speaker, null = unattributed (E-36, D-22).
   *  null means "no verdict" — no enrollment, the filter is off, or a hiccup — and is
   *  treated as the user downstream, so attribution never silences an un-enrolled learner. */
  isUser: 0 | 1 | null;
}

interface SegmentRow {
  id: string;
  session_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  content_hash: string;
  speaker_score: number | null;
  is_user: 0 | 1 | null;
}

function toSegment(r: SegmentRow): Segment {
  return {
    id: r.id,
    sessionId: r.session_id,
    idx: r.idx,
    startMs: r.start_ms,
    endMs: r.end_ms,
    durationMs: r.duration_ms,
    contentHash: r.content_hash,
    speakerScore: r.speaker_score ?? null,
    isUser: r.is_user ?? null,
  };
}

export interface NewSegment {
  sessionId: string;
  idx: number;
  startMs: number;
  endMs: number;
  contentHash: string;
}

/**
 * Insert a segment idempotently (unique per session+idx). A resumed job that
 * re-reaches an already-persisted index inserts nothing and returns the existing
 * row, so segments are never duplicated. duration_ms is derived from the bounds.
 */
export function upsertSegment(db: Db, input: NewSegment): Segment {
  const existing = getSegmentByIndex(db, input.sessionId, input.idx);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO segments (id, session_id, idx, start_ms, end_ms, duration_ms, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.sessionId,
    input.idx,
    input.startMs,
    input.endMs,
    input.endMs - input.startMs,
    input.contentHash,
  );
  return getSegmentByIndex(db, input.sessionId, input.idx)!;
}

/** A session's segments in index order. */
export function listSegments(db: Db, sessionId: string): Segment[] {
  const rows = db
    .prepare("SELECT * FROM segments WHERE session_id = ? ORDER BY idx")
    .all(sessionId) as SegmentRow[];
  return rows.map(toSegment);
}

/** One segment by session + ordered index, or null. */
export function getSegmentByIndex(db: Db, sessionId: string, idx: number): Segment | null {
  const row = db
    .prepare("SELECT * FROM segments WHERE session_id = ? AND idx = ?")
    .get(sessionId, idx) as SegmentRow | undefined;
  return row ? toSegment(row) : null;
}

/** How many other sessions reference this content hash (shared-cache guard). */
export function countByHash(db: Db, contentHash: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM segments WHERE content_hash = ?")
    .get(contentHash) as { n: number };
  return row.n;
}
