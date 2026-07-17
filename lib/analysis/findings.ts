import { randomUUID } from "node:crypto";
import type { Db } from "../db";

// Typed data layer for analysis findings and the never-re-bill segment cache
// (E-4, D-10), in the lib/settings.ts / lib/segments.ts style. Server-only.
//
// A finding is one correction for the dominant speaker, tied to its session and
// to the segment's `content_hash`. `segment_analyses` is the completion witness:
// a row means that audio has been triaged (and deep-listened if flagged), so a
// re-run — or a duplicate segment in another session — reuses these findings and
// makes zero model calls.

export const CATEGORIES = ["grammar", "vocabulary", "phrasing", "idiom", "pronunciation"] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  id: string;
  sessionId: string;
  contentHash: string;
  quote: string;
  correction: string;
  category: Category;
  explanation: string;
  severity: Severity;
  startMs: number;
  endMs: number;
}

/** A validated finding ready to persist (no id/session yet). */
export interface NewFinding {
  quote: string;
  correction: string;
  category: Category;
  explanation: string;
  severity: Severity;
  startMs: number;
  endMs: number;
}

interface FindingRow {
  id: string;
  session_id: string;
  content_hash: string;
  quote: string;
  correction: string;
  category: Category;
  explanation: string;
  severity: Severity;
  start_ms: number;
  end_ms: number;
}

function toFinding(r: FindingRow): Finding {
  return {
    id: r.id,
    sessionId: r.session_id,
    contentHash: r.content_hash,
    quote: r.quote,
    correction: r.correction,
    category: r.category,
    explanation: r.explanation,
    severity: r.severity,
    startMs: r.start_ms,
    endMs: r.end_ms,
  };
}

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}
export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/**
 * Persist a triaged-and-deep-listened segment atomically: insert its findings
 * (possibly none) and write the `segment_analyses` witness in one transaction, so
 * a crash never leaves findings without the witness (which would re-bill) or a
 * witness without its findings. `flagged`/`deepDone` record how far the cascade
 * got: an unflagged segment is complete with no deep call.
 */
export function persistSegmentFindings(
  db: Db,
  input: {
    sessionId: string;
    contentHash: string;
    flagged: boolean;
    deepDone: boolean;
    findings: NewFinding[];
  },
): void {
  const insert = db.prepare(
    `INSERT INTO findings
       (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const f of input.findings) {
      insert.run(
        randomUUID(),
        input.sessionId,
        input.contentHash,
        f.quote,
        f.correction,
        f.category,
        f.explanation,
        f.severity,
        f.startMs,
        f.endMs,
      );
    }
    db.prepare(
      `INSERT INTO segment_analyses (content_hash, flagged, deep_done)
       VALUES (?, ?, ?)
       ON CONFLICT(content_hash) DO UPDATE SET flagged = excluded.flagged, deep_done = excluded.deep_done`,
    ).run(input.contentHash, input.flagged ? 1 : 0, input.deepDone ? 1 : 0);
  })();
}

export interface SegmentAnalysis {
  contentHash: string;
  flagged: boolean;
  deepDone: boolean;
}

/** The analysis witness for a content hash, or null if never analyzed. */
export function getSegmentAnalysis(db: Db, contentHash: string): SegmentAnalysis | null {
  const r = db
    .prepare("SELECT content_hash, flagged, deep_done FROM segment_analyses WHERE content_hash = ?")
    .get(contentHash) as { content_hash: string; flagged: number; deep_done: number } | undefined;
  if (!r) return null;
  return { contentHash: r.content_hash, flagged: !!r.flagged, deepDone: !!r.deep_done };
}

/**
 * Is this audio fully analyzed? True once triage ran and — if the mini flagged
 * it — the deep-listen also ran. Such a segment is a cache hit: never re-billed.
 */
export function isSegmentComplete(a: SegmentAnalysis | null): boolean {
  return !!a && (!a.flagged || a.deepDone);
}

/** All findings recorded for a content hash (from any session). */
export function findingsForHash(db: Db, contentHash: string): Finding[] {
  const rows = db
    .prepare("SELECT * FROM findings WHERE content_hash = ? ORDER BY start_ms, id")
    .all(contentHash) as FindingRow[];
  return rows.map(toFinding);
}

/** A session's findings, in timeline order. */
export function listFindings(db: Db, sessionId: string): Finding[] {
  const rows = db
    .prepare("SELECT * FROM findings WHERE session_id = ? ORDER BY start_ms, id")
    .all(sessionId) as FindingRow[];
  return rows.map(toFinding);
}

function sessionHasHash(db: Db, sessionId: string, contentHash: string): boolean {
  const r = db
    .prepare("SELECT 1 FROM findings WHERE session_id = ? AND content_hash = ? LIMIT 1")
    .get(sessionId, contentHash);
  return !!r;
}

/**
 * Reuse cached findings for a hash into `sessionId`, cloning the canonical rows
 * (from whichever session first produced them) under new ids. Idempotent and
 * billing-free: it makes no model calls and writes no ledger row. A no-op when
 * the hash produced no findings or the session already carries them.
 */
export function reuseCachedFindings(db: Db, sessionId: string, contentHash: string): void {
  if (sessionHasHash(db, sessionId, contentHash)) return;
  const canonical = findingsForHash(db, contentHash);
  if (canonical.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO findings
       (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const f of canonical) {
      insert.run(
        randomUUID(),
        sessionId,
        contentHash,
        f.quote,
        f.correction,
        f.category,
        f.explanation,
        f.severity,
        f.startMs,
        f.endMs,
      );
    }
  })();
}
