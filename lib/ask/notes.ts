import type { Db } from "../db";

// Typed data layer for E-23 "Ask Erika" notes, in the lib/render/renditions.ts
// style. Server-only. An ask-note is one persisted deeper explanation per finding:
// the note text, the ids of the OTHER findings it cites, and the actual text-model
// cost. The `finding_id` PK is the render-once cache key AND the lease that
// serializes generation: the engine claims the row (INSERT) BEFORE it spends, so
// only the request that wins the row calls the model — see lib/ask/engine.ts.
//
// A claim starts with an EMPTY `note` and is completed (UPDATE) by the winning
// call; the cache read (`getCompletedNote`) returns only completed rows, so an
// uncommitted claim never reads as a cached note. A claim that never commits
// (budget refusal or a failed/unreadable call) is released via `deleteNote` so a
// legitimate retry is never blocked. No model calls live here.

export interface AskNote {
  findingId: string;
  note: string;
  /** Ids of the OTHER findings this note cites — always ≥1 on a completed note. */
  citedIds: string[];
  costUsd: number;
  createdAt: string;
}

interface AskNoteRow {
  finding_id: string;
  note: string;
  cited_ids: string;
  cost_usd: number;
  created_at: string;
}

function parseCitedIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toNote(r: AskNoteRow): AskNote {
  return {
    findingId: r.finding_id,
    note: r.note,
    citedIds: parseCitedIds(r.cited_ids),
    costUsd: r.cost_usd,
    createdAt: r.created_at,
  };
}

/**
 * The COMPLETED note for a finding, or null. A note is complete once its winning
 * call has written the text (`note <> ''`); a bare claim row — inserted before the
 * call and still empty — is deliberately NOT returned, so an in-flight claim never
 * reads as a cache hit and never blocks the re-open path from re-leasing after a
 * released failure.
 */
export function getCompletedNote(db: Db, findingId: string): AskNote | null {
  const r = db
    .prepare(
      "SELECT finding_id, note, cited_ids, cost_usd, created_at FROM ask_notes WHERE finding_id = ? AND note <> ''",
    )
    .get(findingId) as AskNoteRow | undefined;
  return r ? toNote(r) : null;
}

/**
 * Claim the `finding_id` row idempotently — this is the ask lease. Inserts a bare
 * claim (empty `note`, no cites, the pre-call cost estimate) and returns whether
 * THIS call inserted it: `true` means we won the claim (proceed to the one budgeted
 * model call, then `completeNote`), `false` means a row already existed (a
 * concurrent ask claimed it first — make NO model call and bill nothing). The
 * `ON CONFLICT DO NOTHING` on the PK makes the claim exclusive; because
 * better-sqlite3 runs statements serially on the connection, two racing asks can
 * never both win the row, so at most one provider call and one ledger row ever
 * result. The engine claims BEFORE it spends (lib/ask/engine.ts).
 */
export function claimNote(db: Db, entry: { findingId: string; costUsd: number }): boolean {
  const info = db
    .prepare(
      "INSERT INTO ask_notes (finding_id, note, cited_ids, cost_usd) VALUES (?, '', '[]', ?) ON CONFLICT(finding_id) DO NOTHING",
    )
    .run(entry.findingId, entry.costUsd);
  return info.changes > 0;
}

/**
 * Complete a won claim: write the generated note, its cited finding ids, and the
 * actual cost. Called only by the request that won the claim, only after a
 * successful model call, inside the same transaction that records the spend — so a
 * note is never stored without its charge nor charged without being stored. Returns
 * the completed note.
 */
export function completeNote(
  db: Db,
  entry: { findingId: string; note: string; citedIds: string[]; costUsd: number },
): AskNote {
  db.prepare("UPDATE ask_notes SET note = ?, cited_ids = ?, cost_usd = ? WHERE finding_id = ?").run(
    entry.note,
    JSON.stringify(entry.citedIds),
    entry.costUsd,
    entry.findingId,
  );
  return getCompletedNote(db, entry.findingId)!;
}

/**
 * Release a claim: delete the `finding_id` row. The engine calls this only on its
 * OWN uncommitted claim when generation does not complete (budget refusal or a
 * failed/unreadable call), so a legitimate retry can re-claim and generate — a
 * claimed row is never a permanent tombstone. Returns whether a row was removed.
 */
export function deleteNote(db: Db, findingId: string): boolean {
  const info = db.prepare("DELETE FROM ask_notes WHERE finding_id = ?").run(findingId);
  return info.changes > 0;
}
