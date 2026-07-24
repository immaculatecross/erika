import { randomUUID } from "node:crypto";
import type { Db } from "../db";

// The enrollment-take store (E-35, D-22). Server-only DB glue for `enrollment_takes`
// — the metadata rows for the on-device voice samples E-36 will match against. The
// audio bytes live on disk (lib/audio-storage.ts, data/enrollment/); this module
// only records where they are and which take is current. Nothing here uploads or
// analyzes anything — an enrollment take is a voice sample, never a session.

export interface EnrollmentTake {
  id: string;
  path: string;
  format: string;
  durationSeconds: number;
  sizeBytes: number;
  createdAt: string;
}

interface EnrollmentRow {
  id: string;
  path: string;
  format: string;
  duration_seconds: number;
  size_bytes: number;
  created_at: string;
}

function toTake(r: EnrollmentRow): EnrollmentTake {
  return {
    id: r.id,
    path: r.path,
    format: r.format,
    durationSeconds: r.duration_seconds,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  };
}

export interface NewEnrollment {
  /** The take id — the caller stages the audio file under it first. */
  id: string;
  path: string;
  format: string;
  durationSeconds: number;
  sizeBytes: number;
}

/** Record an enrollment take's metadata. The id is supplied by the caller (which
 *  wrote the file at `path`). Re-enrollment simply adds another row; the latest wins. */
export function recordEnrollment(db: Db, input: NewEnrollment): EnrollmentTake {
  db.prepare(
    `INSERT INTO enrollment_takes (id, path, format, duration_seconds, size_bytes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.id, input.path, input.format, input.durationSeconds, input.sizeBytes);
  return getEnrollment(db, input.id)!;
}

/** A fresh enrollment-take id. */
export function newEnrollmentId(): string {
  return randomUUID();
}

export function getEnrollment(db: Db, id: string): EnrollmentTake | null {
  const r = db.prepare("SELECT * FROM enrollment_takes WHERE id = ?").get(id) as EnrollmentRow | undefined;
  return r ? toTake(r) : null;
}

/** The active enrollment — the newest take, or null if never enrolled. */
export function latestEnrollment(db: Db): EnrollmentTake | null {
  const r = db
    .prepare("SELECT * FROM enrollment_takes ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as EnrollmentRow | undefined;
  return r ? toTake(r) : null;
}

/** Whether any enrollment take exists — the "enrolled?" flag placement first-run reads. */
export function hasEnrollment(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM enrollment_takes LIMIT 1").get();
}
