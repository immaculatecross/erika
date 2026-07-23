import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { finalizeReservation, recordSpend, type SpendReservation } from "./budget";
import type { ModelId } from "./rates";

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

/**
 * The enriched observation channel on a finding (E-28, D-20). The deep prompt now
 * also asks — per finding — for a pronunciation-suspect note, an italiano-colto
 * register-upgrade suggestion, and a disfluency note. These are annotations ON the
 * finding, orthogonal to its `category`, so rather than widen the closed category
 * vocabulary they ride here as a small JSON object persisted in `findings.notes`.
 * Every field is optional; a finding the model returned no enrichment for stores
 * `null` (not an empty object). Deliberately no free-form keys — only the three the
 * prompt asks for are kept, so the column can never accumulate arbitrary model prose.
 */
export interface FindingNotes {
  /** A flagged pronunciation suspect (gemination, vowel aperture, stress — D-21).
   *  A TEXT FLAG only; scoring is Azure PA on scripted drills (E-37), never here. */
  pronunciation?: string;
  /** An italiano-colto register upgrade the speaker could have reached (D-23). */
  register?: string;
  /** A disfluency note (filler, false start, hesitation). */
  disfluency?: string;
}

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
  /** The profile entry (its correction text) this finding recurs, or null —
   *  written when the deep model cited a valid profile entry (E-19, v10). */
  recurrenceOf?: string | null;
  /** The enriched observation channel (E-28, v16), or null when the model
   *  returned no enrichment for this finding. */
  notes?: FindingNotes | null;
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
  /** Resolved recurrence link (the cited profile entry's correction), if any. */
  recurrenceOf?: string | null;
  /** Enriched observations (E-28), or null/absent for a plain finding. */
  notes?: FindingNotes | null;
}

/**
 * Keep only the three known enrichment fields, each a non-empty string — so a
 * malformed or over-generous `notes` object can never persist arbitrary keys or
 * junk (E-16 defensive parsing, D-13). Returns null when nothing survives, so an
 * absent enrichment stays a clean NULL column rather than `{}`.
 */
export function sanitizeNotes(raw: unknown): FindingNotes | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: FindingNotes = {};
  for (const key of ["pronunciation", "register", "disfluency"] as const) {
    const v = r[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse a stored `notes` JSON column back to a `FindingNotes` (or null). Tolerant:
 *  a corrupt string never throws, it reads as no enrichment. */
export function parseNotesColumn(raw: string | null): FindingNotes | null {
  if (!raw) return null;
  try {
    return sanitizeNotes(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The raw `findings` row shape — exported so lib/findings-model.ts, which owns
 *  the canonical read scopes (E-17), maps rows with the same `toFinding` as here. */
export interface FindingRow {
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
  recurrence_of: string | null;
  notes: string | null;
}

export function toFinding(r: FindingRow): Finding {
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
    recurrenceOf: r.recurrence_of ?? null,
    notes: parseNotesColumn(r.notes ?? null),
  };
}

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}
export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/**
 * Persist a triaged-and-deep-listened segment atomically: record the call's spend
 * (when given), insert its findings (possibly none), and write the
 * `segment_analyses` witness — all in ONE transaction. So a crash can never leave
 * a *charge without its completion witness* (which would re-bill that segment on
 * resume, E-4 criterion 5), nor findings without a witness, nor a witness without
 * its findings: the money record and the completion record commit together or not
 * at all. `flagged`/`deepDone` record how far the cascade got: an unflagged
 * segment is complete with no deep call.
 *
 * The call's spend is committed here in one of two ways, both inside this same
 * transaction: `reservation` (E-27) FINALIZES a pending reserve-before-call row to
 * its actual cost — the racing cascade's path, so the charge that was already
 * counted against the cap becomes committed exactly once with the witness; `spend`
 * records a fresh committed row directly — the legacy path other billers and test
 * fixtures use, where nothing was reserved. At most one is given.
 */
export function persistSegmentFindings(
  db: Db,
  input: {
    sessionId: string;
    contentHash: string;
    flagged: boolean;
    deepDone: boolean;
    findings: NewFinding[];
    /** The real billable call this write completes — recorded in the same txn. */
    spend?: { model: ModelId; contentHash: string; costUsd: number };
    /** The reserve-before-call reservation this write finalizes (E-27), in the same
     *  txn — pending → committed at the actual cost. */
    reservation?: SpendReservation;
    /** Set when the model's reply could not be read even after the repair retry. */
    unreadable?: { reason: string; shape: string | null };
  },
): void {
  // `ON CONFLICT DO NOTHING` targets only the v8 identity index, so replaying the
  // *exact same* write inserts nothing instead of duplicating it. Scope is narrow
  // and deliberate: it makes a repeated write idempotent, and that is all. It does
  // NOT prevent the double-run race — two independent model replies about the same
  // speech disagree on offsets and wording, producing different keys, so both
  // persist. The heartbeat lease (lib/jobs/lease.ts) is what stops a second worker
  // re-running a live job.
  //
  // The key includes `correction` and `category` because `quote` names the
  // erroneous span, not the finding: one utterance can carry both a grammar and a
  // pronunciation finding, and `relStartMs` is optional in the deep-response
  // contract (defaulting to 0), so a narrower key would silently drop the second.
  //
  // A CHECK violation — a bad category or severity — is NOT a uniqueness conflict:
  // it still throws and still rolls the whole transaction back, spend included
  // (E-4 criterion 5).
  const insert = db.prepare(
    `INSERT INTO findings
       (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms, recurrence_of, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id, content_hash, start_ms, quote, correction, category) DO NOTHING`,
  );
  db.transaction(() => {
    if (input.spend) recordSpend(db, input.spend);
    if (input.reservation) finalizeReservation(db, input.reservation);
    for (const f of input.findings) {
      const notes = sanitizeNotes(f.notes);
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
        f.recurrenceOf ?? null,
        notes ? JSON.stringify(notes) : null,
      );
    }
    db.prepare(
      `INSERT INTO segment_analyses (content_hash, flagged, deep_done, unreadable, unreadable_reason, response_shape)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(content_hash) DO UPDATE SET
         flagged = excluded.flagged, deep_done = excluded.deep_done,
         unreadable = excluded.unreadable,
         unreadable_reason = excluded.unreadable_reason,
         response_shape = excluded.response_shape`,
    ).run(
      input.contentHash,
      input.flagged ? 1 : 0,
      input.deepDone ? 1 : 0,
      input.unreadable ? 1 : 0,
      input.unreadable?.reason ?? null,
      input.unreadable?.shape ?? null,
    );
  })();
}

export interface SegmentAnalysis {
  contentHash: string;
  flagged: boolean;
  deepDone: boolean;
  /** The model's reply for this audio could not be read (E-16b criterion 4). */
  unreadable: boolean;
  /** Content-free structural descriptor of that reply, for the failure record. */
  responseShape: string | null;
}

/** The analysis witness for a content hash, or null if never analyzed. */
export function getSegmentAnalysis(db: Db, contentHash: string): SegmentAnalysis | null {
  const r = db
    .prepare(
      "SELECT content_hash, flagged, deep_done, unreadable, response_shape FROM segment_analyses WHERE content_hash = ?",
    )
    .get(contentHash) as
    | { content_hash: string; flagged: number; deep_done: number; unreadable: number; response_shape: string | null }
    | undefined;
  if (!r) return null;
  return {
    contentHash: r.content_hash,
    flagged: !!r.flagged,
    deepDone: !!r.deep_done,
    unreadable: !!r.unreadable,
    responseShape: r.response_shape,
  };
}

/**
 * Is this audio fully analyzed? True once triage ran and — if the mini flagged
 * it — the deep-listen also ran. Such a segment is a cache hit: never re-billed.
 *
 * An unreadable segment is deliberately NOT complete: the audio was never
 * successfully analysed, so a later run should try it again (a truncation is
 * often transient) and the estimate should keep counting it as pending. What
 * stops it looping inside a single run is that the run makes one pass.
 */
export function isSegmentComplete(a: SegmentAnalysis | null): boolean {
  return !!a && !a.unreadable && (!a.flagged || a.deepDone);
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

// The cross-session readers that used to live here (`listAllFindings`,
// `listAllFindingsWithSession`) now live in lib/findings-model.ts as
// `listIncludedFindings` / `listIncludedFindingsWithSession`: reading every row in
// the table flat was one of the six disagreeing answers E-17 consolidated, and the
// scope belongs with the definition, not with the row mapper. This module stays
// the row-level data layer (writes, the segment cache, one session's findings).

/** A finding enriched with its session's capture date and name — for the Archive. */
export interface FindingWithSession extends Finding {
  /** The owning session's `created_at` (SQLite UTC) — the chronological key. */
  sessionCreatedAt: string;
  /** The owning session's original filename — the group header label. */
  sessionFilename: string;
}

function sessionHasHash(db: Db, sessionId: string, contentHash: string): boolean {
  const r = db
    .prepare("SELECT 1 FROM findings WHERE session_id = ? AND content_hash = ? LIMIT 1")
    .get(sessionId, contentHash);
  return !!r;
}

/** Where the segment carrying `contentHash` sits on `sessionId`'s timeline. */
function donorSegmentStart(db: Db, sessionId: string, contentHash: string): number | null {
  const r = db
    .prepare("SELECT start_ms FROM segments WHERE session_id = ? AND content_hash = ? ORDER BY idx LIMIT 1")
    .get(sessionId, contentHash) as { start_ms: number } | undefined;
  return r ? r.start_ms : null;
}

/** The bounds a reused finding is remapped onto — the target session's segment. */
export interface TargetSegment {
  startMs: number;
  endMs: number;
}

/**
 * Remap one donor timestamp onto the target segment: take its offset *within the
 * donor's segment* and re-anchor that offset at the target segment's start,
 * clamped to the target's bounds. When the donor segment row is missing (its
 * session was deleted out from under the findings), there is no offset to recover
 * and clamping alone at least keeps the timestamp inside the target segment.
 */
function remap(absMs: number, donorStart: number | null, target: TargetSegment): number {
  const rel = donorStart === null ? absMs : absMs - donorStart;
  return Math.min(Math.max(target.startMs + rel, target.startMs), target.endMs);
}

/**
 * Reuse cached findings for a hash into `sessionId`, cloning the canonical rows
 * (from whichever session first produced them) under new ids. Idempotent and
 * billing-free: it makes no model calls and writes no ledger row. A no-op when
 * the hash produced no findings or the session already carries them.
 *
 * Timestamps are REMAPPED onto `target`, never copied (E-16 defect 1). A donor
 * finding's `start_ms`/`end_ms` are absolute offsets on the *donor's* timeline:
 * byte-identical audio at 10 s in one session and at 3600 s in another produced a
 * clone reading 11 s — outside the target segment entirely, so jump-to-audio, the
 * archive, and the session timeline all pointed at the wrong moment. What the two
 * segments genuinely share is the offset *within* the segment, so that is what
 * survives the clone; the anchor comes from the target.
 */
export function reuseCachedFindings(
  db: Db,
  sessionId: string,
  contentHash: string,
  target: TargetSegment,
): void {
  if (sessionHasHash(db, sessionId, contentHash)) return;
  const canonical = findingsForHash(db, contentHash);
  if (canonical.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO findings
       (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms, recurrence_of, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id, content_hash, start_ms, quote, correction, category) DO NOTHING`,
  );
  const donorStarts = new Map<string, number | null>();
  db.transaction(() => {
    for (const f of canonical) {
      if (!donorStarts.has(f.sessionId)) {
        donorStarts.set(f.sessionId, donorSegmentStart(db, f.sessionId, contentHash));
      }
      const donorStart = donorStarts.get(f.sessionId)!;
      const startMs = remap(f.startMs, donorStart, target);
      const notes = sanitizeNotes(f.notes);
      insert.run(
        randomUUID(),
        sessionId,
        contentHash,
        f.quote,
        f.correction,
        f.category,
        f.explanation,
        f.severity,
        startMs,
        Math.max(remap(f.endMs, donorStart, target), startMs),
        f.recurrenceOf ?? null,
        notes ? JSON.stringify(notes) : null,
      );
    }
  })();
}
