import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { monthKey, releaseReservation, reserveSpend, type SpendReservation } from "../analysis/budget";
import { realtimeSessionCost, type RealtimeModelId } from "../analysis/rates";

// The realtime tutor's money spine (E-34, D-10/D-20). The tutor is the MOST
// EXPENSIVE money path AND a long-lived session — a call can run for many minutes
// while everything else in the app bills a bounded, known call. So the cap must
// stay hard ACROSS the life of the open session, not just at its start: a long call
// cannot silently blow the budget.
//
// This does NOT fork a second money path (WO — never-waivable). A tutor lease is a
// set of PENDING rows in the ONE `spend_ledger`, reserved through the ONE
// `reserveSpend` (committed + pending ≤ cap, atomically), keyed by the deterministic
// `content_hash` = `tutor:<tutorId>`. The lifecycle:
//
//   * OPEN  — reserve the per-session estimate as a pending row before the WebRTC
//             call is minted. If the cap refuses it, NO token is minted and no
//             session opens (truthful refusal, WO criterion 5).
//   * EXTEND — a heartbeat as the call runs reserves ANOTHER pending block when the
//             call outlasts what is already reserved; the reservation is refused at
//             the cap, so the client must wind the call down — it cannot overshoot.
//   * FINALIZE — on end, release every pending row for the session and commit ONE
//             row for the ACTUAL elapsed cost, clamped to what was reserved (the
//             lease can't be overshot). Exactly one committed ledger row per session.
//   * RELEASE — a session that failed BEFORE opening (a mint failure) drops its
//             pending rows (no charge). But an ABANDONED live session whose client
//             stopped heart-beating is COMMITTED, not released: the startup sweep
//             (`sweepStaleReservations`) commits the reserved amount for a stale
//             `tutor:` lease ([T2a]) — a live session assumed to have run must not
//             vanish from the ledger. Only a pre-open failure gives money back.
//
// The cap-hard guarantee is inherited verbatim from `reserveSpend`; this module adds
// only the session-scoped grouping and the finalize-to-one-committed-row step.

/** The ledger content-hash that groups one tutor session's reservations. */
export function tutorContentHash(tutorId: string): string {
  return `tutor:${tutorId}`;
}

/** Default estimated length of a tutor conversation, in minutes — the pre-call
 *  estimate and the initial lease. Tunable via env; a conservative 10-minute
 *  default (a short spoken lesson). */
export function defaultTutorMinutes(raw: string | undefined = process.env.TUTOR_SESSION_MINUTES): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Minutes reserved per heartbeat extension when a call outlasts its lease. */
export function tutorExtendMinutes(raw: string | undefined = process.env.TUTOR_EXTEND_MINUTES): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

/**
 * [T2b — money] The server-chosen ceiling on a single tutor session, in minutes — an
 * independent second guard alongside the spend cap, bounding a call's LENGTH rather than
 * its cost.
 *
 * Enforcement lives in the heartbeat route, `app/api/tutor/session/[id]/heartbeat/route.ts`:
 * once the SERVER-tracked elapsed time (now − `tutorLeaseOpenedAtMs`, the same source
 * [T2c] finalize floors on) passes `maxTutorSessionSeconds()`, the server refuses to
 * extend the lease — `covered: false` / 402, the same shape the budget refusal returns,
 * so the client winds the call down. Precisely: this is a REFUSAL, not a kill. A client
 * that ignores the refusal keeps billing, bounded from there by the hard spend cap (the
 * cap is what makes overrun finite; the ceiling is what makes it stop on a well-behaved
 * client). The refusal never releases the lease, so the spend already incurred is still
 * committed by `/end` (or by the [T2a] sweep if the call is abandoned).
 *
 * It is deliberately NOT sent to OpenAI. The Realtime session schema has no such field,
 * and posting it as an unknown param 400s the mint — the bug OBS-001 chased; see the
 * allowlist in lib/tutor/mint.ts. Tunable via env; a conservative 30-minute default. */
export function maxTutorSessionMinutes(raw: string | undefined = process.env.TUTOR_MAX_SESSION_MINUTES): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** The [T2b] max-session ceiling in seconds — the unit the heartbeat route compares the
 *  server-tracked elapsed time against. */
export function maxTutorSessionSeconds(): number {
  return Math.round(maxTutorSessionMinutes() * 60);
}

/** The per-session estimate shown before the call (WO criterion 5). */
export function estimateTutorSessionUsd(model: RealtimeModelId, minutes: number): number {
  return realtimeSessionCost(model, minutes);
}

/** Total USD currently PENDING (reserved, not yet finalized) for a tutor session. */
export function tutorReservedUsd(db: Db, tutorId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'pending'",
    )
    .get(tutorContentHash(tutorId)) as { total: number };
  return row.total;
}

/**
 * [T2c — money] The server's own record of when a tutor session opened: the EARLIEST
 * `reserved_at` across the lease's pending rows (the open lease reserved at OPEN),
 * parsed to epoch ms, or null if the session has no open lease. Used to FLOOR the
 * finalized duration at the real server-tracked elapsed time so a client cannot
 * under-report a long call to under-pay — the server never trusts client elapsed alone.
 */
export function tutorLeaseOpenedAtMs(db: Db, tutorId: string): number | null {
  const row = db
    .prepare(
      "SELECT MIN(reserved_at) AS opened FROM spend_ledger WHERE content_hash = ? AND state = 'pending'",
    )
    .get(tutorContentHash(tutorId)) as { opened: string | null };
  if (!row.opened) return null;
  const ms = new Date(`${row.opened.replace(" ", "T")}Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The realtime model an open lease reserved under (read from its pending rows), or
 *  null if the session has no open lease. The heartbeat/finalize routes derive the
 *  model server-side from the lease, never trusting the client. */
export function tutorLeaseModel(db: Db, tutorId: string): RealtimeModelId | null {
  const row = db
    .prepare("SELECT model FROM spend_ledger WHERE content_hash = ? AND state = 'pending' LIMIT 1")
    .get(tutorContentHash(tutorId)) as { model: RealtimeModelId } | undefined;
  return row?.model ?? null;
}

/**
 * Open a tutor lease: reserve `minutes` of `model` as a pending row against the cap,
 * atomically. Returns the reservation, or `null` when the cap refuses it — in which
 * case the caller must NOT mint a token and must NOT open a session (WO criterion 5).
 */
export function openTutorLease(
  db: Db,
  tutorId: string,
  model: RealtimeModelId,
  minutes: number,
  budgetUsd: number,
): SpendReservation | null {
  const costUsd = estimateTutorSessionUsd(model, minutes);
  return reserveSpend(db, { model, contentHash: tutorContentHash(tutorId), costUsd }, budgetUsd);
}

/**
 * The heartbeat primitive (WO criterion 5). Ensure the open lease reserves at least
 * `minutesNeeded` of `model` — reserving ONE additional pending block for the
 * shortfall if the call has outlasted what was already reserved, and nothing when the
 * lease already covers it (an idempotent heartbeat never over-reserves). Returns true
 * if the lease now covers the elapsed call, false if the cap refused the extension —
 * the client then winds the call down. Every extension is a fresh `reserveSpend`
 * (committed + pending ≤ cap atomically), so the tutor cannot overshoot however long
 * it runs.
 */
export function ensureTutorLeaseCovers(
  db: Db,
  tutorId: string,
  model: RealtimeModelId,
  minutesNeeded: number,
  budgetUsd: number,
): boolean {
  const needed = estimateTutorSessionUsd(model, minutesNeeded);
  const shortfall = needed - tutorReservedUsd(db, tutorId);
  if (shortfall <= 1e-9) {
    // Covered — but the lease must still show that it is ALIVE. See below.
    touchTutorLease(db, tutorId, model);
    return true;
  }
  const r = reserveSpend(db, { model, contentHash: tutorContentHash(tutorId), costUsd: shortfall }, budgetUsd);
  return r !== null;
}

/** How stale a lease's newest row may get before a heartbeat refreshes its liveness.
 *  Well under `RESERVATION_STALE_MS` (15 min), and far above the 20 s heartbeat, so a
 *  live call writes a handful of these and an abandoned one writes none. */
export const LEASE_KEEPALIVE_MS = 4 * 60_000;

/**
 * [E-43] MARK AN OPEN LEASE AS STILL LIVE.
 *
 * ⚠️ THE OLD CLAIM WAS "the sweep cannot touch a live session at any TTL", AND IT WAS
 * NOT TRUE. It rested on an accident of configuration: `ensureTutorLeaseCovers` only
 * inserts a row when the call outlasts what is already reserved, so for the first
 * `defaultTutorMinutes()` (10) minutes a lease's newest — and only — row is the one
 * written at OPEN. That is younger than `RESERVATION_STALE_MS` (15 min) purely because
 * 10 < 15, which nothing pinned. Raise `TUTOR_SESSION_MINUTES` to 20 and a perfectly
 * live conversation is swept at minute 15, which is the 1.9× overbill again by a
 * different door. The 10-minute minimum makes long calls the NORM, so this stopped
 * being theoretical.
 *
 * The fix makes liveness an OBSERVED FACT rather than an inference from constants: a
 * heartbeat that needs no money still writes a **zero-cost pending row**, so the
 * lease's newest `reserved_at` is at most `LEASE_KEEPALIVE_MS` old while a client is
 * talking to us. `sweepStaleReservations` judges staleness on `MAX(reserved_at)`, so a
 * heart-beating session is unreachable at ANY ttl — and one that stops heart-beating
 * goes stale on the normal TTL and commits whole, which is exactly what should happen.
 *
 * Three properties make a $0 row safe here, and all three are load-bearing:
 *   * it adds nothing to `tutorReservedUsd`, so it cannot move the cap or the clamp;
 *   * it is always the NEWEST row, so it never moves `MIN(reserved_at)` — [T2b]'s
 *     duration ceiling and [T2c]'s under-report floor both read that minimum, and
 *     moving it forward is precisely how the original defect disabled them;
 *   * it carries the lease's own model, so the sweep's `MIN(model)` grouping and
 *     `tutorLeaseModel`'s `LIMIT 1` cannot read a different model from it.
 */
export function touchTutorLease(db: Db, tutorId: string, model: RealtimeModelId, now: Date = new Date()): boolean {
  const hash = tutorContentHash(tutorId);
  const row = db
    .prepare("SELECT MAX(reserved_at) AS newest FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
    .get(hash) as { newest: string | null };
  if (!row.newest) return false; // no open lease — nothing to keep alive
  const newestMs = new Date(`${row.newest.replace(" ", "T")}Z`).getTime();
  if (Number.isFinite(newestMs) && now.getTime() - newestMs < LEASE_KEEPALIVE_MS) return false;
  db.prepare(
    "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state) VALUES (?, ?, ?, ?, 0, 'pending')",
  ).run(randomUUID(), monthKey(now), model, hash);
  return true;
}

/**
 * Finalize a tutor session to its ACTUAL elapsed cost: release every pending row for
 * the session and write exactly ONE committed row for the elapsed cost of `model`,
 * clamped so the committed charge never exceeds what was reserved (the lease can't be
 * overshot). Runs in one transaction so the release and the commit are atomic.
 * Returns the committed USD. A session with nothing reserved commits nothing.
 *
 * [T2c — money] The billed minutes are `max(clientMinutes, serverMinutes)`: the
 * server-tracked elapsed time (now − the lease's open `reserved_at`) FLOORS the
 * client-reported figure, so a client cannot under-report a long call to under-pay.
 * The server figure is read BEFORE the pending rows are deleted. Clamping to the
 * reserved amount still holds, so a floored duration can never overshoot the lease.
 */
export function finalizeTutorLease(
  db: Db,
  tutorId: string,
  model: RealtimeModelId,
  actualMinutes: number,
  date: Date = new Date(),
): number {
  const hash = tutorContentHash(tutorId);
  return db.transaction((): number => {
    const reserved = tutorReservedUsd(db, tutorId);
    const openedAt = tutorLeaseOpenedAtMs(db, tutorId);
    const serverMinutes = openedAt !== null ? Math.max(0, (date.getTime() - openedAt) / 60000) : 0;
    const billedMinutes = Math.max(Math.max(0, actualMinutes), serverMinutes);
    const actual = estimateTutorSessionUsd(model, billedMinutes);
    const committed = Math.min(actual, reserved);
    db.prepare("DELETE FROM spend_ledger WHERE content_hash = ? AND state = 'pending'").run(hash);
    if (committed > 0) {
      db.prepare(
        "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state) VALUES (?, ?, ?, ?, ?, 'committed')",
      ).run(randomUUID(), monthKey(date), model, hash, committed);
    }
    return committed;
  })();
}

/** Release an open lease without charging (an abandoned or failed session). Drops
 *  every pending row for the session; committed rows are never touched. */
export function releaseTutorLease(db: Db, tutorId: string): void {
  const r = db
    .prepare("SELECT id FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
    .all(tutorContentHash(tutorId)) as { id: string }[];
  for (const { id } of r) releaseReservation(db, id);
}

// ── ONE LEG AGAIN (E-43, Amendment 5) ────────────────────────────────────────
//
// This branch briefly carried a SECOND money path here: a per-reply TTS reservation
// (`tutor-tts:<id>:<seq>`), reserved before each synthesis call and settled on the
// bytes that arrived. It went with the speaking leg it billed. The tutor is back to
// ONE billable leg — the Realtime session itself — so there is one lease, one prefix
// and one committed row per conversation, and no second vendor call to reserve
// against mid-turn.
//
// That is a real simplification of the money spine and not just of the transport: a
// reply used to be able to be refused by the cap HALFWAY THROUGH A CONVERSATION,
// leaving a live session that could hear but not answer. It cannot now; the only
// refusal points are opening a session and extending its lease.
