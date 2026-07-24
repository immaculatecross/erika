import { cefrRank, type Syllabus, type SyllabusRule } from "./types";

// The prerequisite-DAG validator (E-26b). The syllabus is only usable by the future
// composer if the prerequisite graph is a real DAG: every `prereqs` id resolves to a
// rule in the set, there are no cycles, and a linear learning order therefore exists
// (a topological sort). This module proves all three and returns that order. Pure and
// deterministic — the same asset always yields the same order (ties broken by key),
// so the composer's "what can I teach today" question has one stable answer.

export interface ValidationError {
  key: string;
  problem: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** A valid learning order (prereqs before dependants) when `ok`; else null. */
  order: string[] | null;
}

/**
 * Validate the syllabus DAG. Checks, in order:
 *  1. no rule lists itself as a prerequisite;
 *  2. every prerequisite key resolves to a real rule in the set;
 *  3. a rule never depends on one at a STRICTLY higher CEFR level (the curriculum
 *     must not require the harder thing first — a soundness check beyond acyclicity);
 *  4. the graph is acyclic — proven by producing a topological order (Kahn's
 *     algorithm); if one exists the set is topologically sortable.
 * Returns every problem found (not just the first) so authoring fixes are batchable.
 */
export function validateSyllabus(syllabus: Syllabus): ValidationResult {
  const rules = syllabus.rules;
  const byKey = new Map<string, SyllabusRule>(rules.map((r) => [r.key, r]));
  const errors: ValidationError[] = [];

  for (const r of rules) {
    for (const p of r.prereqs) {
      if (p === r.key) errors.push({ key: r.key, problem: `lists itself as a prerequisite` });
      else if (!byKey.has(p)) errors.push({ key: r.key, problem: `prereq "${p}" resolves to no rule` });
      else if (cefrRank(byKey.get(p)!.cefr) > cefrRank(r.cefr))
        errors.push({ key: r.key, problem: `prereq "${p}" (${byKey.get(p)!.cefr}) is above this rule's ${r.cefr}` });
    }
  }
  // Resolution errors make the topo sort meaningless — report them and stop.
  if (errors.length > 0) return { ok: false, errors, order: null };

  const order = topoSort(rules);
  if (order === null) {
    for (const key of findCycleMembers(rules))
      errors.push({ key, problem: `is part of a prerequisite cycle` });
    return { ok: false, errors, order: null };
  }
  return { ok: true, errors: [], order };
}

/** Kahn's algorithm. Returns a topological order (prereqs first), or null if a cycle
 *  blocks completion. Ties are broken by key so the order is deterministic. */
export function topoSort(rules: SyllabusRule[]): string[] | null {
  const indegree = new Map<string, number>();
  const dependants = new Map<string, string[]>(); // prereq → rules that need it
  for (const r of rules) {
    indegree.set(r.key, r.prereqs.length);
    for (const p of r.prereqs) {
      if (!dependants.has(p)) dependants.set(p, []);
      dependants.get(p)!.push(r.key);
    }
  }
  // A stable frontier: all currently-zero-indegree keys, drained in key order.
  const ready = rules.filter((r) => (indegree.get(r.key) ?? 0) === 0).map((r) => r.key).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift()!;
    order.push(key);
    for (const dep of dependants.get(key) ?? []) {
      const d = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, d);
      if (d === 0) insertSorted(ready, dep);
    }
  }
  return order.length === rules.length ? order : null;
}

/** Insert into an ascending array keeping it sorted (small frontiers, so linear is fine). */
function insertSorted(arr: string[], value: string): void {
  let i = 0;
  while (i < arr.length && arr[i] < value) i++;
  arr.splice(i, 0, value);
}

/** The keys still carrying a non-zero indegree after Kahn's algorithm — i.e. the
 *  rules trapped in (or downstream of) a cycle. Diagnostic only. */
function findCycleMembers(rules: SyllabusRule[]): string[] {
  const indegree = new Map<string, number>();
  const dependants = new Map<string, string[]>();
  for (const r of rules) {
    indegree.set(r.key, r.prereqs.length);
    for (const p of r.prereqs) {
      if (!dependants.has(p)) dependants.set(p, []);
      dependants.get(p)!.push(r.key);
    }
  }
  const ready = rules.filter((r) => (indegree.get(r.key) ?? 0) === 0).map((r) => r.key);
  while (ready.length > 0) {
    const key = ready.shift()!;
    for (const dep of dependants.get(key) ?? []) {
      const d = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, d);
      if (d === 0) ready.push(dep);
    }
  }
  return rules.filter((r) => (indegree.get(r.key) ?? 0) > 0).map((r) => r.key).sort();
}

/** Convenience: the level histogram of a syllabus (for tests and the exit report). */
export function cefrHistogram(syllabus: Syllabus): Record<string, number> {
  const h: Record<string, number> = {};
  for (const r of syllabus.rules) h[r.cefr] = (h[r.cefr] ?? 0) + 1;
  return h;
}
