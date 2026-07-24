import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { monthKey, reserveSpend, releaseReservation, type SpendReservation } from "../analysis/budget";
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
 * [T2b — money] The server-chosen HARD ceiling on a single tutor session, in minutes —
 * an independent second guard alongside the spend cap, bounding a call's LENGTH rather
 * than its cost, and a bound the client cannot lengthen.
 *
 * Enforcement lives in the heartbeat route, `app/api/tutor/session/[id]/heartbeat/route.ts`:
 * once the SERVER-tracked elapsed time (now − `tutorLeaseOpenedAtMs`, the same source
 * [T2c] finalize floors on) passes `maxTutorSessionSeconds()`, the heartbeat refuses with
 * `covered: false` / 402 — the same shape the budget refusal returns, so the client winds
 * the call down. The refusal never releases the lease, so the spend already incurred is
 * still committed by `/end` (or by the [T2a] sweep if the call is abandoned).
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
  if (shortfall <= 1e-9) return true; // already covered — heartbeat is a no-op
  const r = reserveSpend(db, { model, contentHash: tutorContentHash(tutorId), costUsd: shortfall }, budgetUsd);
  return r !== null;
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
