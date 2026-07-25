import type { Db } from "../db";
import { localDay } from "../local-day";
import { readSettings } from "../settings";
import { maxTutorSessionSeconds } from "./money";

// The durable conversation record (E-43, migration v29) — and the CONTRACT WO-E44
// CONSUMES to credit the day. E-44 should read through this module, never through raw
// SQL over `tutor_conversations`: one reader means one answer to "did a conversation
// count today", the same way `lib/findings-model.ts` is the one gate over findings
// (E-17).
//
// A conversation below the minimum is still REAL: it happened, it logged evidence,
// its recording still becomes a session and findings. It simply has not met the bar.
// Nothing about that is a failure and nothing in the UI may treat it as one (D-24: no
// countdown, no warning, no guilt copy if the learner leaves early).

/** One recorded conversation. `durationSeconds`/`endedAt` are null while it is open. */
export interface TutorConversation {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  minSeconds: number;
  metMinimum: boolean;
  sessionId: string | null;
  localDay: string | null;
}

interface Row {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  min_seconds: number;
  met_minimum: number;
  session_id: string | null;
  local_day: string | null;
}

function toConversation(r: Row): TutorConversation {
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    minSeconds: r.min_seconds,
    metMinimum: r.met_minimum === 1,
    sessionId: r.session_id,
    localDay: r.local_day,
  };
}

/** The minimum a conversation must run to count toward the day, in seconds. */
export function tutorMinimumSeconds(db: Db): number {
  return Math.max(0, Math.round(readSettings(db).tutorMinMinutes * 60));
}

/** Open a conversation record. The minimum is COPIED IN at open, so changing the
 *  setting later never rewrites what already happened. */
export function openConversation(db: Db, id: string, minSeconds: number): TutorConversation {
  db.prepare("INSERT INTO tutor_conversations (id, min_seconds) VALUES (?, ?)").run(id, minSeconds);
  return getConversation(db, id)!;
}

export function getConversation(db: Db, id: string): TutorConversation | null {
  const row = db.prepare("SELECT * FROM tutor_conversations WHERE id = ?").get(id) as Row | undefined;
  return row ? toConversation(row) : null;
}

/**
 * The conversation's SERVER-MEASURED elapsed seconds: now − `started_at`. Null when
 * there is no such open conversation.
 */
export function serverElapsedSeconds(db: Db, id: string, now: Date = new Date()): number | null {
  const row = db.prepare("SELECT started_at FROM tutor_conversations WHERE id = ?").get(id) as
    | { started_at: string }
    | undefined;
  if (!row) return null;
  const startedMs = new Date(`${row.started_at.replace(" ", "T")}Z`).getTime();
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, (now.getTime() - startedMs) / 1000);
}

/**
 * Close a conversation and decide, once and durably, whether it met its minimum.
 *
 * ⚠️ DURATION IS SERVER-MEASURED AND THE CLIENT MAY ONLY LOWER IT (criterion 7).
 * `clientSeconds` is taken only when it is SMALLER than the server's own elapsed
 * time. The server's figure counts from the instant the session opened, which
 * includes connecting and any idling; the client knows how much of that was actually
 * a conversation. So a client can honestly report less and can never inflate.
 *
 * This is the OPPOSITE polarity from the money path, deliberately: there the server
 * FLOORS the client (`finalizeTutorLease`, [T2c]) so nobody under-pays a long call.
 * Two different questions, each taking its own conservative side.
 *
 * Idempotent: a conversation already closed is returned unchanged, so a retried `/end`
 * or a `pagehide` beacon racing the button cannot rewrite a recorded day.
 */
export function closeConversation(
  db: Db,
  id: string,
  input: { clientSeconds?: number | null; sessionId?: string | null } = {},
  now: Date = new Date(),
): TutorConversation | null {
  const existing = getConversation(db, id);
  if (!existing) return null;
  if (existing.endedAt !== null) return existing;

  const server = serverElapsedSeconds(db, id, now) ?? 0;
  const client = input.clientSeconds;
  const duration =
    typeof client === "number" && Number.isFinite(client) && client >= 0 ? Math.min(server, client) : server;
  const met = duration >= existing.minSeconds ? 1 : 0;

  db.prepare(
    "UPDATE tutor_conversations SET ended_at = datetime('now'), duration_seconds = ?, met_minimum = ?, " +
      "session_id = COALESCE(?, session_id), local_day = ? WHERE id = ? AND ended_at IS NULL",
  ).run(duration, met, input.sessionId ?? null, localDay(now), id);
  return getConversation(db, id);
}

/**
 * Close any conversation left open past the point where it could still be live —
 * the browser was closed, the machine slept, the tab crashed.
 *
 * It is recorded as ended with **NULL duration and `met_minimum = 0`**, because we
 * genuinely do not know how long it ran, and the alternative (crediting it at the
 * session ceiling) would be a lie in the generous direction. The honest answer to an
 * unknown is not a favourable guess. The common case is covered before this ever
 * fires: the tutor page sends its elapsed time on `pagehide`.
 *
 * Returns how many were closed. Cheap and idempotent; called when a tutor session
 * opens, so the record self-heals with no extra process.
 */
export function closeAbandonedConversations(db: Db, now: Date = new Date()): number {
  const graceSeconds = maxTutorSessionSeconds() + 300;
  const res = db
    .prepare(
      "UPDATE tutor_conversations SET ended_at = datetime('now'), met_minimum = 0, local_day = ? " +
        "WHERE ended_at IS NULL AND started_at <= datetime('now', ?)",
    )
    .run(localDay(now), `-${graceSeconds} seconds`);
  return res.changes;
}

/** Every CLOSED conversation on a local day, newest first. */
export function conversationsForDay(db: Db, day: string = localDay()): TutorConversation[] {
  const rows = db
    .prepare("SELECT * FROM tutor_conversations WHERE local_day = ? AND ended_at IS NOT NULL ORDER BY started_at DESC")
    .all(day) as Row[];
  return rows.map(toConversation);
}

/**
 * THE ONE QUESTION WO-E44 ASKS: did a conversation meet its minimum on this local
 * day? A conversation that ran but fell short answers false without any of it being
 * treated as a failure anywhere else.
 */
export function metMinimumOnDay(db: Db, day: string = localDay()): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM tutor_conversations WHERE local_day = ? AND ended_at IS NOT NULL AND met_minimum = 1",
    )
    .get(day) as { n: number };
  return row.n > 0;
}

/**
 * Link a conversation to the recording it produced, by CAPTURE TIME.
 *
 * The tutor page uploads its take through the same `uploadAudio` contract as any
 * capture and declares `capturedAt` = the instant the conversation started (E-42's
 * v28 column). Erika is single-user and local-first (D-2), so a session whose capture
 * instant falls inside this conversation's window and which no other conversation has
 * claimed is unambiguously this conversation's recording. Nothing is guessed: with no
 * such session the link stays NULL, which is what criterion 7's "when one exists"
 * means.
 */
export function linkRecordingByCaptureTime(db: Db, id: string, now: Date = new Date()): string | null {
  const conv = getConversation(db, id);
  if (!conv || conv.sessionId) return conv?.sessionId ?? null;
  const endedAt = conv.endedAt ?? now.toISOString().replace("T", " ").slice(0, 19);
  const row = db
    .prepare(
      "SELECT id FROM sessions WHERE COALESCE(captured_at, created_at) >= ? " +
        "AND COALESCE(captured_at, created_at) <= datetime(?, '+120 seconds') " +
        "AND id NOT IN (SELECT session_id FROM tutor_conversations WHERE session_id IS NOT NULL) " +
        "ORDER BY COALESCE(captured_at, created_at) DESC LIMIT 1",
    )
    .get(conv.startedAt, endedAt) as { id: string } | undefined;
  if (!row) return null;
  db.prepare("UPDATE tutor_conversations SET session_id = ? WHERE id = ?").run(row.id, id);
  return row.id;
}
