import type { Db } from "../db";
import { ruleItemId } from "./items";
import { loadSyllabus, validateSyllabus, ruleKeyToItemId } from "../syllabus";

// Seeding the grammar syllabus into `knowledge_items` (E-26b, D-19). The v18
// migration calls this; a test calls it directly against a throwaway DB. It loads
// the committed, DAG-validated asset (`lib/syllabus/grammar-it.json`) and upserts
// one `rule:` row per rule, setting ONLY the reference columns `prereqs` (the
// prerequisite edges, as knowledge item ids) and `cefr` (the rule's CEFR level).
//
// IDEMPOTENT and NON-CLOBBERING (the WO's hard contract, mirroring the E-26a
// lexicon seed). Every knowledge_items column other than the reference pair is
// DERIVED/evidence-driven state — a rebuildable cache (`srs_*`, `status`,
// `recording_attested`; see `lib/knowledge/derive.ts`) or a projection of the
// append-only evidence log. So the upsert:
//   INSERT ... ON CONFLICT(id) DO UPDATE SET prereqs, cefr  -- and NOTHING else
// A `rule:` row that already accrued SRS state or evidence keeps all of it; only
// its `prereqs`/`cefr` are (re)written. A fresh row is inserted with the seed's
// reference columns and the schema defaults for everything else (status 'unseen',
// recording_attested 0). The runner wraps the whole migration in one transaction.
//
// The DAG is validated BEFORE any write: a malformed asset (a dangling prereq or a
// cycle) throws here rather than seeding a broken curriculum. `prereqs` is stored
// as a JSON array of ids (`rule:<key>`), the shape `lib/knowledge/items.ts` reads
// back, so the future composer (v0.5/E-31) can walk the graph directly.

/** Error thrown when the committed syllabus asset fails DAG validation at seed time. */
export class InvalidSyllabusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSyllabusError";
  }
}

/** Seed (or refresh) the grammar syllabus; returns the number of rule rows upserted. */
export function seedGrammarSyllabus(db: Db): number {
  const syllabus = loadSyllabus();
  const result = validateSyllabus(syllabus);
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.key}: ${e.problem}`).join("; ");
    throw new InvalidSyllabusError(`syllabus DAG is invalid — ${detail}`);
  }
  const upsert = db.prepare(
    `INSERT INTO knowledge_items (id, kind, prereqs, cefr)
       VALUES (@id, 'rule', @prereqs, @cefr)
     ON CONFLICT(id) DO UPDATE SET
       prereqs = excluded.prereqs,
       cefr    = excluded.cefr`,
  );
  const tx = db.transaction((rules: typeof syllabus.rules) => {
    for (const r of rules) {
      upsert.run({
        id: ruleItemId(r.key),
        prereqs: JSON.stringify(r.prereqs.map(ruleKeyToItemId)),
        cefr: r.cefr,
      });
    }
  });
  tx(syllabus.rules);
  return syllabus.rules.length;
}
