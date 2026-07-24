import { createHash } from "node:crypto";
import type { Db } from "../db";

// Typed data layer for E-33 phrase renders — the per-phrase TTS cache the shadow and
// reading formats share, in the lib/render/renditions.ts style. Server-only. A
// phrase render is one rendered CORRECT Italian phrase keyed by a content hash of
// (text + register + voice): its on-disk path and the actual TTS cost. The `hash`
// PK is the render-once cache key AND the lease that serializes generation — the
// engine claims the row (INSERT) BEFORE it spends, so only the request that wins the
// row calls the model (lib/render/phrase.ts). A claim that never commits (budget
// refusal / failed synthesize) is released via `deletePhraseRender`. No model calls
// live here.

/** The neutral default voice — matches the E-21 renditions default; a per-user voice
 *  is out of scope. Kept in the hash so a voice change re-renders rather than
 *  serving a stale clip. */
export const PHRASE_VOICE = "alloy";

/**
 * The cache key for a phrase render: a SHA-256 over the exact text, the register
 * (D-23 — a different register is a different delivery, so a different clip), and the
 * voice. Deterministic and collision-safe; hex, so it is a valid filename.
 */
export function phraseHash(text: string, register: string, voice: string = PHRASE_VOICE): string {
  return createHash("sha256").update(`${voice}\n${register}\n${text}`, "utf8").digest("hex");
}

export interface PhraseRender {
  hash: string;
  text: string;
  register: string;
  path: string;
  costUsd: number;
  createdAt: string;
}

interface PhraseRenderRow {
  hash: string;
  text: string;
  register: string;
  path: string;
  cost_usd: number;
  created_at: string;
}

function toPhraseRender(r: PhraseRenderRow): PhraseRender {
  return {
    hash: r.hash,
    text: r.text,
    register: r.register,
    path: r.path,
    costUsd: r.cost_usd,
    createdAt: r.created_at,
  };
}

/** The render for a phrase hash, or null if it has never been rendered. */
export function getPhraseRender(db: Db, hash: string): PhraseRender | null {
  const r = db
    .prepare("SELECT hash, text, register, path, cost_usd, created_at FROM phrase_renders WHERE hash = ?")
    .get(hash) as PhraseRenderRow | undefined;
  return r ? toPhraseRender(r) : null;
}

/**
 * Claim the `hash` row idempotently — this is the render lease (E-21's proven
 * pattern). Returns whether THIS call inserted it: `true` = we won the claim (proceed
 * to the one budgeted model call, then record the spend), `false` = a row already
 * existed (a concurrent render claimed it first — make NO model call and bill
 * nothing). `ON CONFLICT DO NOTHING` on the PK makes the claim exclusive, and
 * better-sqlite3 runs statements serially, so two racing renders can never both win.
 */
export function insertPhraseRender(
  db: Db,
  entry: { hash: string; text: string; register: string; path: string; costUsd: number },
): boolean {
  const info = db
    .prepare(
      "INSERT INTO phrase_renders (hash, text, register, path, cost_usd) VALUES (?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING",
    )
    .run(entry.hash, entry.text, entry.register, entry.path, entry.costUsd);
  return info.changes > 0;
}

/**
 * Release a claim: delete the `hash` row. The engine calls this only on its OWN
 * uncommitted claim when generation does not complete (budget refusal / failed
 * synthesize), so a retry can re-claim — a claimed row is never a permanent
 * tombstone. Returns whether a row was removed.
 */
export function deletePhraseRender(db: Db, hash: string): boolean {
  const info = db.prepare("DELETE FROM phrase_renders WHERE hash = ?").run(hash);
  return info.changes > 0;
}
