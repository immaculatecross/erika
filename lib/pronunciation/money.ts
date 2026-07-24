import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { monthKey, reserveSpend, releaseReservation, type SpendReservation } from "../analysis/budget";
import { PA_MODEL, pronunciationCallCost } from "../analysis/rates";

// The pronunciation studio's money spine (E-37, D-10/D-21). Azure Pronunciation
// Assessment is a NEW BILLED EXTERNAL CALL and the first non-OpenAI provider in this
// app, so the rule that matters most is the one that does NOT change: it goes through
// the existing reserve-before-call discipline, into the ONE `spend_ledger`, under the
// ONE monthly cap. No second money path (never-waivable).
//
// The lifecycle, mirroring lib/tutor/money.ts:
//
//   * RESERVE  — before the HTTP request, `reserveSpend` inserts a PENDING row for the
//                take's estimated cost, atomically (committed + pending + cost ≤ cap
//                or refused). A refusal means NO call is made: no charge, and — the
//                thing a learner would notice — NO SCORE. The studio says so plainly.
//   * FINALIZE — on a resolved call the reservation is committed at the cost of the
//                ACTUAL audio duration, clamped to what was reserved (the lease can
//                never be overshot). Exactly one committed row per assessment.
//   * FINALIZE-ON-UNREADABLE — Azure answered (and therefore billed) but the body was
//                unreadable: the reservation is FINALIZED, never released. A resolved
//                call bills even when it is useless to us (the E-16 defect-4 rule).
//   * RELEASE  — no response at all (no key, network failure, 4xx): nothing was
//                charged, so the pending row is dropped and the cap is freed.
//   * CRASH    — a pending `pa:` row that outlives the sweep TTL COMMITS rather than
//                releasing (`isAssumedRunLeaseHash`, lib/analysis/budget.ts): the
//                reservation is taken immediately before the request, so an abandoned
//                one means the audio was already on the wire when the process died.
//                Recording spend even on a crash is the never-waivable half.
//
// The estimate and the charge are computed by the SAME function over the same audio
// seconds (`pronunciationCallCost`), so finalizing can never raise committed spend
// above what the cap already admitted.

/** The ledger content-hash that groups one assessment's reservation. The `pa:` prefix
 *  is load-bearing: it is what makes an abandoned lease commit on sweep. */
export function pronunciationLeaseHash(attemptId: string): string {
  return `pa:${attemptId}`;
}

/** Worst-case USD to assess `seconds` of audio — the reserved amount, and the same
 *  upper bound the cap checks before the real call. Display-safe (no I/O). */
export function estimatePronunciationUsd(seconds: number): number {
  return pronunciationCallCost(PA_MODEL, seconds);
}

/** Total USD currently PENDING (reserved, not yet finalized) for one attempt. */
export function pronunciationReservedUsd(db: Db, attemptId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'pending'",
    )
    .get(pronunciationLeaseHash(attemptId)) as { total: number };
  return row.total;
}

/**
 * Reserve one assessment's estimated cost as a pending row against the cap, atomically.
 * Returns the reservation, or `null` when the cap refuses it — in which case the caller
 * must NOT make the request (no charge, no score).
 */
export function openPronunciationLease(
  db: Db,
  attemptId: string,
  seconds: number,
  budgetUsd: number,
): SpendReservation | null {
  const costUsd = estimatePronunciationUsd(seconds);
  return reserveSpend(db, { model: PA_MODEL, contentHash: pronunciationLeaseHash(attemptId), costUsd }, budgetUsd);
}

/**
 * Finalize one assessment to the cost of its ACTUAL audio duration: drop the pending
 * row(s) and write exactly ONE committed row, clamped to what was reserved. Runs in one
 * transaction so the release and the commit are atomic, and is safe to call inside a
 * caller's wider transaction (better-sqlite3 nests via savepoints) — which is how the
 * charge and the stored attempt commit together or not at all. Returns the committed USD.
 */
export function finalizePronunciationLease(
  db: Db,
  attemptId: string,
  actualSeconds: number,
  date: Date = new Date(),
): number {
  const hash = pronunciationLeaseHash(attemptId);
  return db.transaction((): number => {
    const reserved = pronunciationReservedUsd(db, attemptId);
    const committed = Math.min(estimatePronunciationUsd(actualSeconds), reserved);
    db.prepare("DELETE FROM spend_ledger WHERE content_hash = ? AND state = 'pending'").run(hash);
    if (committed > 0) {
      db.prepare(
        "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state) VALUES (?, ?, ?, ?, ?, 'committed')",
      ).run(randomUUID(), monthKey(date), PA_MODEL, hash, committed);
    }
    return committed;
  })();
}

/** Release an open lease without charging — the no-response path (missing key,
 *  network failure, a 4xx Azure never billed). Idempotent. */
export function releasePronunciationLease(db: Db, attemptId: string): void {
  const rows = db
    .prepare("SELECT id FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
    .all(pronunciationLeaseHash(attemptId)) as { id: string }[];
  for (const { id } of rows) releaseReservation(db, id);
}
