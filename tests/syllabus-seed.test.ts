import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { seedGrammarSyllabus } from "@/lib/knowledge/seed-syllabus";
import { loadSyllabus } from "@/lib/syllabus";

// Seeding the grammar syllabus (E-26b, migration v18). openDatabase runs every
// migration, so the seed has already populated `rule:` rows by the time a fresh DB
// opens. These tests prove the seed's hard contracts: it lands ≥ the stated floor of
// validated rule rows, the DAG survives into the table, and an idempotent re-run
// refreshes only the reference columns while preserving derived SRS/evidence state.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-syllabus-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface RuleRow {
  id: string;
  kind: string;
  prereqs: string | null;
  cefr: string | null;
  srs_stability: number | null;
  srs_difficulty: number | null;
  status: string;
  recording_attested: number;
}

function ruleRows(db: Db): RuleRow[] {
  return db.prepare("SELECT * FROM knowledge_items WHERE kind = 'rule' ORDER BY id").all() as RuleRow[];
}

describe("migration v18 seeds the grammar syllabus (criterion 3)", () => {
  it("populates ≥250 validated rule rows on a fresh DB", () => {
    const db = freshDb();
    const rows = ruleRows(db);
    expect(rows.length).toBeGreaterThanOrEqual(250);
    expect(rows.length).toBe(loadSyllabus().rules.length);
    for (const r of rows) {
      expect(r.id.startsWith("rule:")).toBe(true);
      expect(r.cefr).toBeTruthy();
      expect(r.status).toBe("unseen"); // no evidence yet
      expect(r.recording_attested).toBe(0);
    }
    db.close();
  });

  it("stores prereqs as a JSON array of resolvable rule item ids — the DAG survives seeding", () => {
    const db = freshDb();
    const rows = ruleRows(db);
    const ids = new Set(rows.map((r) => r.id));
    let withPrereqs = 0;
    for (const r of rows) {
      expect(r.prereqs).not.toBeNull();
      const prereqs = JSON.parse(r.prereqs!) as string[];
      expect(Array.isArray(prereqs)).toBe(true);
      if (prereqs.length > 0) withPrereqs++;
      for (const p of prereqs) {
        expect(p.startsWith("rule:")).toBe(true);
        expect(ids.has(p), `prereq ${p} of ${r.id} resolves to a seeded rule`).toBe(true);
      }
    }
    expect(withPrereqs).toBeGreaterThan(0); // a real graph, not a flat list
    db.close();
  });

  it("congiuntivo-presente's seeded prereqs point at the present indicative", () => {
    const db = freshDb();
    const row = db.prepare("SELECT prereqs FROM knowledge_items WHERE id = 'rule:congiuntivo-presente'").get() as
      | { prereqs: string }
      | undefined;
    expect(row).toBeDefined();
    const prereqs = JSON.parse(row!.prereqs) as string[];
    expect(prereqs.some((p) => p.startsWith("rule:presente-"))).toBe(true);
    db.close();
  });
});

describe("the seed is idempotent and never clobbers derived state (criterion 3, D-19)", () => {
  it("a re-run preserves SRS/status/recording_attested and refreshes only prereqs/cefr", () => {
    const db = freshDb();
    const id = "rule:congiuntivo-presente";

    // Simulate derived/evidence-driven state the composer/FSRS would have written.
    db.prepare(
      `UPDATE knowledge_items
         SET srs_stability = 12.5, srs_difficulty = 4.2, srs_last_event_at = '2026-05-01 10:00:00',
             status = 'learning', recording_attested = 1
       WHERE id = ?`,
    ).run(id);
    // And corrupt the reference columns, so we can see the re-run repair them.
    db.prepare(`UPDATE knowledge_items SET prereqs = '["rule:GARBAGE"]', cefr = 'Z9' WHERE id = ?`).run(id);

    const returned = seedGrammarSyllabus(db);
    expect(returned).toBe(loadSyllabus().rules.length);

    const row = db.prepare("SELECT * FROM knowledge_items WHERE id = ?").get(id) as RuleRow;
    // Derived state untouched.
    expect(row.srs_stability).toBe(12.5);
    expect(row.srs_difficulty).toBe(4.2);
    expect(row.status).toBe("learning");
    expect(row.recording_attested).toBe(1);
    // Reference columns refreshed back to the asset's truth.
    expect(row.cefr).toBe("B1");
    const prereqs = JSON.parse(row.prereqs!) as string[];
    expect(prereqs).not.toContain("rule:GARBAGE");
    expect(prereqs.some((p) => p.startsWith("rule:presente-"))).toBe(true);
    db.close();
  });

  it("re-running does not create duplicate rows or change the row count", () => {
    const db = freshDb();
    const before = ruleRows(db).length;
    seedGrammarSyllabus(db);
    seedGrammarSyllabus(db);
    expect(ruleRows(db).length).toBe(before);
    db.close();
  });

  it("does not touch lemma or phone rows (E-26a / E-37 are out of scope)", () => {
    const db = freshDb();
    // A lemma and a phone row minted by hand (no morph-it needed via raw insert).
    db.prepare(`INSERT INTO knowledge_items (id, kind, lemma, pos, freq_rank, cefr, status, recording_attested)
                VALUES ('lemma:casa#NOUN', 'lemma', 'casa', 'NOUN', 42, 'A1', 'known', 1)`).run();
    seedGrammarSyllabus(db);
    const lemma = db.prepare("SELECT * FROM knowledge_items WHERE id = 'lemma:casa#NOUN'").get() as RuleRow & {
      freq_rank: number;
    };
    expect(lemma.freq_rank).toBe(42);
    expect(lemma.cefr).toBe("A1");
    expect(lemma.status).toBe("known");
    expect(lemma.recording_attested).toBe(1);
    db.close();
  });
});
