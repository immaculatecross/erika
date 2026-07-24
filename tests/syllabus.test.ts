import { describe, expect, it } from "vitest";
import {
  loadSyllabus,
  validateSyllabus,
  topoSort,
  cefrHistogram,
  CEFR_LEVELS,
  cefrRank,
  ruleKeyToItemId,
  type SyllabusRule,
} from "@/lib/syllabus";

// The grammar syllabus asset (E-26b, D-19): a prerequisite-ordered A1→C2 curriculum.
// These tests are the human-checked gate's automated half — the DAG must be a real
// DAG (acyclic, resolvable, topologically sortable), the coverage must span the whole
// CEFR spine well past the ≥250-rule floor, and the named landmark rules must sit at
// the right level with the right prerequisites.

const syllabus = loadSyllabus();
const byKey = new Map<string, SyllabusRule>(syllabus.rules.map((r) => [r.key, r]));

describe("syllabus asset shape", () => {
  it("has a version and a non-trivial rule set", () => {
    expect(syllabus.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(syllabus.language).toBe("it");
    expect(syllabus.rules.length).toBeGreaterThanOrEqual(250); // operator floor
  });

  it("every rule has a kebab-case key, a CEFR level, a title, a description and ≥1 example", () => {
    for (const r of syllabus.rules) {
      expect(r.key).toMatch(/^[a-z0-9-]+$/);
      expect(CEFR_LEVELS).toContain(r.cefr);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.examples.length).toBeGreaterThanOrEqual(1);
      for (const ex of r.examples) expect(ex.trim().length).toBeGreaterThan(0);
    }
  });

  it("keys are unique", () => {
    const keys = syllabus.rules.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the prerequisite DAG (criterion 2)", () => {
  const result = validateSyllabus(syllabus);

  it("is valid: acyclic, every prereq resolves, topologically sortable", () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.order).not.toBeNull();
    expect(result.order!.length).toBe(syllabus.rules.length);
  });

  it("the topological order places every prereq before its dependant", () => {
    const order = result.order!;
    const position = new Map(order.map((k, i) => [k, i]));
    for (const r of syllabus.rules) {
      for (const p of r.prereqs) {
        expect(position.get(p)!).toBeLessThan(position.get(r.key)!);
      }
    }
  });

  it("no rule depends on a rule at a strictly higher CEFR level", () => {
    for (const r of syllabus.rules) {
      for (const p of r.prereqs) {
        expect(cefrRank(byKey.get(p)!.cefr)).toBeLessThanOrEqual(cefrRank(r.cefr));
      }
    }
  });

  it("topoSort returns null on an injected cycle", () => {
    const a: SyllabusRule = { key: "a", cefr: "A1", area: "x", title: "a", description: "d", prereqs: ["b"], examples: ["e"] };
    const b: SyllabusRule = { key: "b", cefr: "A1", area: "x", title: "b", description: "d", prereqs: ["a"], examples: ["e"] };
    expect(topoSort([a, b])).toBeNull();
    const bad = validateSyllabus({ ...syllabus, rules: [a, b] });
    expect(bad.ok).toBe(false);
  });

  it("flags a dangling prereq", () => {
    const a: SyllabusRule = { key: "a", cefr: "A1", area: "x", title: "a", description: "d", prereqs: ["ghost"], examples: ["e"] };
    const bad = validateSyllabus({ ...syllabus, rules: [a] });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].problem).toMatch(/resolves to no rule/);
  });
});

describe("CEFR coverage spans the whole spine well past the floor", () => {
  const hist = cefrHistogram(syllabus);

  it("has rules at every level A1→C2", () => {
    for (const level of CEFR_LEVELS) expect(hist[level] ?? 0).toBeGreaterThan(0);
  });

  it("has a genuinely developed C1/C2 italiano-colto tail", () => {
    expect((hist.C1 ?? 0) + (hist.C2 ?? 0)).toBeGreaterThanOrEqual(40);
  });
});

describe("named landmark rules exist at the right level with the right prereqs (criterion 2)", () => {
  function rule(key: string): SyllabusRule {
    const r = byKey.get(key);
    expect(r, `rule "${key}" must exist`).toBeDefined();
    return r!;
  }

  it("congiuntivo-presente is a B1 rule that requires the present indicative", () => {
    const r = rule("congiuntivo-presente");
    expect(r.cefr).toBe("B1");
    // "requires the present indicative" — depends on at least one presente-* rule.
    expect(r.prereqs.some((p) => p.startsWith("presente-"))).toBe(true);
  });

  it("periodo-ipotetico-irreale sits in the C-tail chain with congiuntivo + condizionale prereqs", () => {
    const r = rule("periodo-ipotetico-irreale");
    expect(["B2", "C1"]).toContain(r.cefr);
    expect(r.prereqs).toContain("congiuntivo-trapassato");
    expect(r.prereqs).toContain("condizionale-passato");
  });

  it("passato-remoto-narrativo is a colto C1 rule built on the irregular passato remoto", () => {
    const r = rule("passato-remoto-narrativo");
    expect(r.cefr).toBe("C1");
    expect(r.prereqs).toContain("passato-remoto-irregolare");
  });

  it("concordanza-tempi-congiuntivo (sequence of tenses) requires both subjunctive pasts", () => {
    const r = rule("concordanza-tempi-congiuntivo");
    expect(r.prereqs).toContain("congiuntivo-passato");
    expect(r.prereqs).toContain("congiuntivo-trapassato");
  });

  it("come-se is a C2 rule requiring the pluperfect-subjunctive nuance", () => {
    const r = rule("come-se");
    expect(r.cefr).toBe("C2");
    expect(r.prereqs).toContain("congiuntivo-trapassato-sfumature");
  });

  it("the colto tail names are all present (passato remoto, trapassato remoto, connettivi colti, register)", () => {
    for (const key of [
      "passato-remoto-regolare",
      "passato-remoto-irregolare",
      "trapassato-remoto",
      "connettivi-colti",
      "connettivi-letterari-arcaici",
      "concordanza-tempi-indicativo",
      "registri-diafasici",
      "futuro-condizionale-attenuativi",
    ]) {
      expect(byKey.has(key), `colto rule "${key}"`).toBe(true);
    }
  });

  it("ruleKeyToItemId builds the knowledge item id", () => {
    expect(ruleKeyToItemId("congiuntivo-presente")).toBe("rule:congiuntivo-presente");
  });
});
