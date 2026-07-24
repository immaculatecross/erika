import type { Db } from "../db";
import { readYield, type KnowledgeYield } from "./yield";

// [RETRO-002 T2] The dev-only knowledge inspector's read model. A DIAGNOSTIC, not a
// product surface: it is the "what does the knowledge core actually hold?" view the
// composer's inputs are checked against — the produced-lemma yield (emitted /
// attested / dropped), the item-status distribution, the recording-attested count,
// the evidence log shape, and the sizes of the pools the daily composer draws new
// items from. It is explicitly NOT the operator's deferred "what Erika knows about
// you" user surface (that stays a product decision); this is gated to dev builds.
// Read-only, no model calls.

export interface KnowledgeInspection {
  yield: KnowledgeYield;
  /** knowledge_items counts by kind × status. */
  itemsByKindStatus: { kind: string; status: string; count: number }[];
  recordingAttested: number;
  /** evidence log shape — a fold's raw material. */
  evidence: { total: number; bySource: { source: string; count: number }[]; byMode: { mode: string; count: number }[]; positive: number };
  /** The new-item pools the composer selects from today (WO criterion 6: proves the
   *  exclusion logic has real data to act on). */
  composerPool: { unseenVocab: number; unseenRules: number; unseenPhones: number };
}

function rows<T>(db: Db, sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

function scalar(db: Db, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

export function buildKnowledgeInspection(db: Db): KnowledgeInspection {
  return {
    yield: readYield(db),
    itemsByKindStatus: rows(
      db,
      "SELECT kind, status, COUNT(*) AS count FROM knowledge_items GROUP BY kind, status ORDER BY kind, status",
    ),
    recordingAttested: scalar(db, "SELECT COUNT(*) AS n FROM knowledge_items WHERE recording_attested = 1"),
    evidence: {
      total: scalar(db, "SELECT COUNT(*) AS n FROM evidence"),
      bySource: rows(db, "SELECT source, COUNT(*) AS count FROM evidence GROUP BY source ORDER BY source"),
      byMode: rows(db, "SELECT mode, COUNT(*) AS count FROM evidence GROUP BY mode ORDER BY mode"),
      positive: scalar(db, "SELECT COUNT(*) AS n FROM evidence WHERE polarity = 1"),
    },
    composerPool: {
      unseenVocab: scalar(
        db,
        "SELECT COUNT(*) AS n FROM knowledge_items WHERE kind='lemma' AND status='unseen' AND recording_attested=0 AND freq_rank IS NOT NULL",
      ),
      unseenRules: scalar(db, "SELECT COUNT(*) AS n FROM knowledge_items WHERE kind='rule' AND status='unseen'"),
      unseenPhones: scalar(db, "SELECT COUNT(*) AS n FROM knowledge_items WHERE kind='phone' AND status='unseen'"),
    },
  };
}
