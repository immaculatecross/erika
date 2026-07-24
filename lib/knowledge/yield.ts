import type { Db } from "../db";

// [RETRO-002 T2] Knowledge-core yield instrumentation. The produced-lemma pipeline
// (E-28) turns the deep pass's `produced` lemmas into positive evidence — but only
// morph-it-ATTESTED ones survive; the rest are DROPPED. A near-empty attestation
// yield would starve the daily composer's new-item exclusion silently, so this
// module keeps cumulative counters (emitted vs attested vs dropped) that the dev
// knowledge inspector surfaces. It de-risks E-31's own inputs: it proves the
// composer has real produced-lemma data to act on, or shows loudly that it doesn't.
//
// The counters are cumulative and durable, stored as JSON in the existing settings
// key/value table (the `letterViewedWeek` precedent, lib/plan.ts) — no migration,
// no new table for a dev-only diagnostic. They are observability, never product
// state: nothing the user sees depends on them.

const KEY = "knowledgeYield";

export interface KnowledgeYield {
  /** Lemmas the deep pass reported as produced (before the morph-it gate). */
  emitted: number;
  /** Of those, the ones morph-it attested and that became evidence. */
  attested: number;
  /** Of those, the ones dropped (unattested / wrong POS / write refused). */
  dropped: number;
}

const ZERO: KnowledgeYield = { emitted: 0, attested: 0, dropped: 0 };

export function readYield(db: Db): KnowledgeYield {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return { ...ZERO };
  try {
    const parsed = JSON.parse(row.value) as Partial<KnowledgeYield>;
    return {
      emitted: Number(parsed.emitted) || 0,
      attested: Number(parsed.attested) || 0,
      dropped: Number(parsed.dropped) || 0,
    };
  } catch {
    return { ...ZERO };
  }
}

/** Add a run's counts to the cumulative yield and return the new totals. */
export function bumpYield(db: Db, delta: KnowledgeYield): KnowledgeYield {
  const next: KnowledgeYield = {
    emitted: readYield(db).emitted + delta.emitted,
    attested: readYield(db).attested + delta.attested,
    dropped: readYield(db).dropped + delta.dropped,
  };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(KEY, JSON.stringify(next));
  return next;
}
