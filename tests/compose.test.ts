import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  composePlan,
  compose,
  DEFAULT_CAPS,
  NEW_KINDS,
  type ComposeInput,
  type NewItemCandidate,
} from "@/lib/compose";
import { ensureLemmaItem, recordEvidence } from "@/lib/knowledge";

// The daily composer (E-31). The pure core is exercised against hand-built
// candidate lists (ordering / interleave / caps / overflow→spill); the DB glue is
// exercised against a real seeded inventory (edge selection, the rule DAG, the
// known/attested exclusions, and idempotent spill reconciliation). Zero model calls
// anywhere on this path — there is no network client to mock because none is used.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-compose-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function vocab(n: number): NewItemCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ itemId: `lemma:v${i}#NOUN`, kind: "vocab" as const }));
}
function baseInput(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    day: "2026-07-24",
    nextDay: "2026-07-25",
    spill: [],
    reviews: [],
    slips: [],
    findings: [],
    fresh: { vocab: [], rule: [], pronunciation: [] },
    caps: { ...DEFAULT_CAPS },
    ...over,
  };
}

describe("composePlan — priority ordering (criterion 1)", () => {
  it("assembles spill → reviews → slips → findings → fresh new items", () => {
    const plan = composePlan(
      baseInput({
        spill: [{ itemId: "lemma:sp#NOUN", kind: "vocab" }],
        reviews: [{ cardId: "c1", itemId: null, retrievability: 0.4 }],
        slips: [{ slipId: "s1" }],
        findings: [{ findingId: "f1" }],
        fresh: { vocab: [{ itemId: "lemma:fr#NOUN", kind: "vocab" }], rule: [], pronunciation: [] },
      }),
    );
    expect(plan.items.map((i) => i.source)).toEqual(["spill", "due", "active", "unspent", "fresh"]);
    expect(plan.items.map((i) => i.ref)).toEqual(["lemma:sp#NOUN", "c1", "s1", "f1", "lemma:fr#NOUN"]);
  });

  it("orders reviews worst-retrievability first (caller-sorted), preserved through the plan", () => {
    const plan = composePlan(
      baseInput({
        reviews: [
          { cardId: "worst", itemId: null, retrievability: 0.1 },
          { cardId: "mid", itemId: null, retrievability: 0.5 },
          { cardId: "best", itemId: null, retrievability: 0.9 },
        ],
      }),
    );
    expect(plan.items.map((i) => i.ref)).toEqual(["worst", "mid", "best"]);
  });
});

describe("composePlan — interleave + caps (criterion 1)", () => {
  it("interleaves new-item kinds round-robin rather than blocking one kind", () => {
    const plan = composePlan(
      baseInput({
        fresh: {
          vocab: [
            { itemId: "v1", kind: "vocab" },
            { itemId: "v2", kind: "vocab" },
          ],
          rule: [{ itemId: "r1", kind: "rule" }],
          pronunciation: [
            { itemId: "p1", kind: "pronunciation" },
            { itemId: "p2", kind: "pronunciation" },
          ],
        },
        caps: { newVocab: 10, newRules: 10, newPron: 10, dailyMax: 40 },
      }),
    );
    expect(plan.items.map((i) => i.ref)).toEqual(["v1", "r1", "p1", "v2", "p2"]);
    expect(NEW_KINDS).toEqual(["vocab", "rule", "pronunciation"]);
  });

  it("caps new items per kind; spill counts toward the cap before fresh", () => {
    const plan = composePlan(
      baseInput({
        spill: [
          { itemId: "sp1", kind: "vocab" },
          { itemId: "sp2", kind: "vocab" },
        ],
        fresh: { vocab: vocab(10), rule: [], pronunciation: [] },
        caps: { newVocab: 3, newRules: 3, newPron: 3, dailyMax: 40 },
      }),
    );
    // cap 3: two spill items + one fresh; the rest of fresh is not selected.
    expect(plan.counts.vocab).toBe(3);
    expect(plan.items.map((i) => i.ref)).toEqual(["sp1", "sp2", "lemma:v0#NOUN"]);
    expect(plan.items.slice(0, 2).every((i) => i.source === "spill")).toBe(true);
  });
});

describe("composePlan — overflow spills to tomorrow (criterion 1)", () => {
  it("keeps dailyMax items and spills the FRESH overflow forward, never reviews/slips", () => {
    const plan = composePlan(
      baseInput({
        reviews: [
          { cardId: "c1", itemId: null, retrievability: 0.1 },
          { cardId: "c2", itemId: null, retrievability: 0.2 },
        ],
        findings: [{ findingId: "f1" }],
        fresh: { vocab: vocab(5), rule: [], pronunciation: [] },
        caps: { newVocab: 10, newRules: 0, newPron: 0, dailyMax: 4 },
      }),
    );
    // assembled = [c1, c2, f1, v0, v1, v2, v3, v4]; dailyMax 4 → serve [c1,c2,f1,v0].
    expect(plan.items.map((i) => i.ref)).toEqual(["c1", "c2", "f1", "lemma:v0#NOUN"]);
    // The four fresh new items beyond capacity spill to tomorrow — reviews/finding never do.
    expect(plan.spillForward.map((s) => s.itemId)).toEqual([
      "lemma:v1#NOUN",
      "lemma:v2#NOUN",
      "lemma:v3#NOUN",
      "lemma:v4#NOUN",
    ]);
    expect(plan.spillForward.every((s) => s.plannedFor === "2026-07-25")).toBe(true);
  });
});

// ── DB glue against a real seeded inventory ─────────────────────────────────

describe("compose (DB) — new-item selection at the knowledge edge (criterion 2)", () => {
  function topUnseenVocab(db: Db, n: number): string[] {
    return (
      db
        .prepare(
          `SELECT id FROM knowledge_items WHERE kind='lemma' AND status='unseen' AND recording_attested=0 AND freq_rank IS NOT NULL ORDER BY freq_rank ASC LIMIT ?`,
        )
        .all(n) as { id: string }[]
    ).map((r) => r.id);
  }

  it("draws vocab by freq_rank and respects the cap", () => {
    const db = freshDb();
    const plan = compose(db, "2026-07-24");
    const vocabRefs = plan.items.filter((i) => i.kind === "vocab").map((i) => i.ref);
    expect(vocabRefs).toHaveLength(DEFAULT_CAPS.newVocab);
    expect(vocabRefs).toEqual(topUnseenVocab(db, DEFAULT_CAPS.newVocab));
    db.close();
  });

  it("excludes recording-attested and known lemmas from new-item selection", () => {
    const db = freshDb();
    const [first] = topUnseenVocab(db, 1);
    // Attest the most-frequent unseen lemma: a spontaneous, audio-derived, correct
    // finding-sourced row (what recordProducedLemmas writes) → recording_attested.
    recordEvidence(db, {
      itemId: first,
      source: "finding",
      polarity: 1,
      mode: "spontaneous",
      audioDerived: true,
    });
    const plan = compose(db, "2026-07-24");
    const vocabRefs = plan.items.filter((i) => i.kind === "vocab").map((i) => i.ref);
    expect(vocabRefs).not.toContain(first); // attested → excluded
    expect(vocabRefs[0]).toBe(topUnseenVocab(db, 1)[0]); // the next lemma took its place
    db.close();
  });

  it("respects the rule DAG — a rule is eligible only once its prereqs are learned", () => {
    const db = freshDb();
    // Find a seeded rule that has ≥1 prerequisite.
    const dependent = db
      .prepare(
        "SELECT id, prereqs FROM knowledge_items WHERE kind='rule' AND prereqs IS NOT NULL AND prereqs <> '[]' LIMIT 1",
      )
      .get() as { id: string; prereqs: string };
    const prereqs = JSON.parse(dependent.prereqs) as string[];
    const wide = { newVocab: 0, newRules: 500, newPron: 0, dailyMax: 5000 };

    const before = compose(db, "2026-07-24", wide).items.map((i) => i.ref);
    expect(before).not.toContain(dependent.id); // prereqs still unseen → blocked

    // Learn every prereq (a real cued drill → status 'learning').
    for (const p of prereqs) {
      recordEvidence(db, { itemId: p, source: "exercise", polarity: 1, mode: "cued", audioDerived: false });
    }
    const after = compose(db, "2026-07-25", wide).items.map((i) => i.ref);
    expect(after).toContain(dependent.id); // now eligible
    db.close();
  });
});

describe("compose (DB) — spill drain + overflow are idempotent (criterion 1)", () => {
  it("writes fresh overflow to tomorrow, drains it next day, and is stable on re-run", () => {
    const db = freshDb();
    const tight = { newVocab: 5, newRules: 0, newPron: 0, dailyMax: 2 };

    const run1 = compose(db, "2026-07-24", tight);
    // dailyMax 2 → 2 vocab served, 3 spill forward to the 25th.
    expect(run1.items.filter((i) => i.kind === "vocab")).toHaveLength(2);
    expect(run1.spillForward).toHaveLength(3);
    const spillAfter1 = db.prepare("SELECT item_id, planned_for FROM spill_queue ORDER BY item_id").all();

    // Re-running the SAME day converges to the same queue (idempotent).
    const run2 = compose(db, "2026-07-24", tight);
    expect(run2.items.map((i) => i.ref)).toEqual(run1.items.map((i) => i.ref));
    const spillAfter2 = db.prepare("SELECT item_id, planned_for FROM spill_queue ORDER BY item_id").all();
    expect(spillAfter2).toEqual(spillAfter1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spill_queue").get() as { n: number }).n).toBe(3);

    // Next day: the 3 spilled items are drained first (priority: source 'spill').
    const run3 = compose(db, "2026-07-25", tight);
    const served = run3.items.filter((i) => i.kind === "vocab");
    expect(served.slice(0, 2).every((i) => i.source === "spill")).toBe(true);
    db.close();
  });
});
