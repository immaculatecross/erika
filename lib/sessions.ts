import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { AudioFormat, IngestState, Session } from "./session-types";

// Data layer for captured sessions and their ingest jobs (E-2 part 1). Typed,
// server-only, mirroring lib/settings.ts. This module is the single ingestion
// entry point both file-upload (now) and mic-capture (E-2 part 2) funnel
// through: createSession is called once the bytes are on disk and probed.
// Client-safe constants/types live in ./session-types and are re-exported here.
export * from "./session-types";

/** A fresh session id — minted by the caller so it can stage files under it. */
export function newSessionId(): string {
  return randomUUID();
}

// Caps are read from the environment at call time so tests can inject low
// values without reloading modules. Defaults: 2 GB, 24 h.
export function maxUploadBytes(): number {
  return Number(process.env.MAX_UPLOAD_BYTES ?? 2 * 1024 ** 3);
}
export function maxDurationSeconds(): number {
  return Number(process.env.MAX_DURATION_SECONDS ?? 24 * 60 * 60);
}

interface SessionRow {
  id: string;
  original_filename: string;
  format: string;
  size_bytes: number;
  duration_seconds: number;
  created_at: string;
  job_state: IngestState;
  exclude_from_evidence: number;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    format: row.format,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    jobState: row.job_state,
    excludeFromEvidence: row.exclude_from_evidence === 1,
  };
}

const SELECT = `
  SELECT s.id, s.original_filename, s.format, s.size_bytes, s.duration_seconds,
         s.created_at, s.exclude_from_evidence, j.state AS job_state
  FROM sessions s
  JOIN ingest_jobs j ON j.session_id = s.id
`;

export interface NewSession {
  id: string;
  originalFilename: string;
  format: AudioFormat;
  sizeBytes: number;
  durationSeconds: number;
}

/**
 * Insert a session and its one queued ingest job atomically. The id is supplied
 * by the caller (which staged the files under it). Returns the full session.
 */
export function createSession(db: Db, input: NewSession): Session {
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertJob = db.prepare(`INSERT INTO ingest_jobs (id, session_id, state) VALUES (?, ?, 'queued')`);
  db.transaction(() => {
    insertSession.run(
      input.id,
      input.originalFilename,
      input.format,
      input.sizeBytes,
      input.durationSeconds,
    );
    insertJob.run(randomUUID(), input.id);
  })();
  return getSession(db, input.id)!;
}

/** Every session, newest first. */
export function listSessions(db: Db): Session[] {
  const rows = db.prepare(`${SELECT} ORDER BY s.created_at DESC, s.id DESC`).all() as SessionRow[];
  return rows.map(toSession);
}

/** One session by id, or null. */
export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined;
  return row ? toSession(row) : null;
}

/**
 * Delete a session; its ingest_jobs cascade. Returns whether a row existed.
 * The caller removes the on-disk directory (see lib/audio-storage).
 */
export function deleteSession(db: Db, id: string): boolean {
  const info = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return info.changes > 0;
}

/**
 * Set/clear the manual "not me" exclusion on a session (E-36, D-22). An excluded
 * session mints no produced-lemma positive evidence on its next analysis run,
 * regardless of the acoustic verdict. Returns whether a row existed. This does NOT
 * retroactively remove already-minted evidence (the log is append-only); it governs
 * future production credit for the session.
 */
export function setSessionExcluded(db: Db, id: string, excluded: boolean): boolean {
  const info = db
    .prepare("UPDATE sessions SET exclude_from_evidence = ? WHERE id = ?")
    .run(excluded ? 1 : 0, id);
  return info.changes > 0;
}
