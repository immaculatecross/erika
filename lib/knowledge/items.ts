import type { Db } from "../db";
import { attestsLemma } from "../lexicon/morphit";
import { isPos, type Pos } from "../lexicon/pos";
import type { ItemKind, KnowledgeItem, KnowledgeStatus } from "./types";

// Knowledge items: the things the user is learning (E-25). Server-only DB glue for
// the `knowledge_items` table. An item is a lemma+POS (with a lazy sense split), a
// grammar rule, or a phone. The one invariant this module enforces is the D-19
// canonical-lemma gate: a lemma item can only be minted for a (lemma, POS) morph-it
// attests — `ensureLemmaItem` throws otherwise, and because every evidence write
// resolves its item through here (lib/knowledge/evidence.ts), no evidence row can
// carry an unvalidated lemma id either.

/** Error thrown when a lemma id is not attested by morph-it (the validator gate). */
export class UnvalidatedLemmaError extends Error {
  constructor(lemma: string, pos: string) {
    super(`morph-it does not attest lemma "${lemma}" as ${pos}`);
    this.name = "UnvalidatedLemmaError";
  }
}

/** Build a lemma item id: `lemma:<lemma>#<POS>` (+`#<sense>` once a split is forced). */
export function lemmaItemId(lemma: string, pos: Pos, senseKey?: string | null): string {
  const base = `lemma:${lemma}#${pos}`;
  return senseKey ? `${base}#${senseKey}` : base;
}

export function ruleItemId(key: string): string {
  return `rule:${key}`;
}

export function phoneItemId(symbol: string): string {
  return `phone:${symbol}`;
}

/** The (kind, lemma, pos, senseKey) an id encodes — the inverse of the builders. */
export function parseItemId(
  id: string,
): { kind: ItemKind; lemma: string | null; pos: Pos | null; senseKey: string | null } {
  if (id.startsWith("lemma:")) {
    const [lemma, pos, sense] = id.slice("lemma:".length).split("#");
    return {
      kind: "lemma",
      lemma: lemma ?? null,
      pos: isPos(pos) ? pos : null,
      senseKey: sense ?? null,
    };
  }
  if (id.startsWith("rule:")) return { kind: "rule", lemma: null, pos: null, senseKey: null };
  return { kind: "phone", lemma: null, pos: null, senseKey: null };
}

interface ItemRow {
  id: string;
  kind: ItemKind;
  lemma: string | null;
  pos: string | null;
  sense_key: string | null;
  freq_rank: number | null;
  cefr: string | null;
  prereqs: string | null;
  srs_stability: number | null;
  srs_difficulty: number | null;
  srs_last_event_at: string | null;
  status: KnowledgeStatus;
}

function toItem(r: ItemRow): KnowledgeItem {
  return {
    id: r.id,
    kind: r.kind,
    lemma: r.lemma,
    pos: isPos(r.pos) ? r.pos : null,
    senseKey: r.sense_key,
    freqRank: r.freq_rank,
    cefr: r.cefr,
    prereqs: r.prereqs ? (JSON.parse(r.prereqs) as string[]) : null,
    srsStability: r.srs_stability,
    srsDifficulty: r.srs_difficulty,
    srsLastEventAt: r.srs_last_event_at,
    status: r.status,
  };
}

export function getItem(db: Db, id: string): KnowledgeItem | null {
  const r = db.prepare("SELECT * FROM knowledge_items WHERE id = ?").get(id) as ItemRow | undefined;
  return r ? toItem(r) : null;
}

export function listItems(db: Db): KnowledgeItem[] {
  const rows = db.prepare("SELECT * FROM knowledge_items ORDER BY id").all() as ItemRow[];
  return rows.map(toItem);
}

/**
 * Ensure a lemma item exists for `(lemma, pos)` (optionally a forced sense),
 * returning its id. Idempotent (INSERT OR IGNORE). Throws `UnvalidatedLemmaError`
 * if morph-it does not attest the pair — the D-19 canonical-lemma gate. This is
 * the ONLY path that mints a lemma item, so an unvalidated lemma can never enter
 * `knowledge_items` (nor, therefore, `evidence`).
 */
export function ensureLemmaItem(db: Db, lemma: string, pos: Pos, senseKey?: string | null): string {
  if (!attestsLemma(lemma, pos)) throw new UnvalidatedLemmaError(lemma, pos);
  const id = lemmaItemId(lemma, pos, senseKey);
  db.prepare(
    `INSERT OR IGNORE INTO knowledge_items (id, kind, lemma, pos, sense_key)
     VALUES (?, 'lemma', ?, ?, ?)`,
  ).run(id, lemma, pos, senseKey ?? null);
  return id;
}

/** Ensure a grammar-rule item exists (with an optional prerequisite id list). */
export function ensureRuleItem(
  db: Db,
  key: string,
  opts: { prereqs?: string[]; cefr?: string | null } = {},
): string {
  const id = ruleItemId(key);
  db.prepare(
    `INSERT OR IGNORE INTO knowledge_items (id, kind, prereqs, cefr) VALUES (?, 'rule', ?, ?)`,
  ).run(id, opts.prereqs ? JSON.stringify(opts.prereqs) : null, opts.cefr ?? null);
  return id;
}

/** Ensure a phone (pronunciation target) item exists. */
export function ensurePhoneItem(db: Db, symbol: string): string {
  const id = phoneItemId(symbol);
  db.prepare(`INSERT OR IGNORE INTO knowledge_items (id, kind) VALUES (?, 'phone')`).run(id);
  return id;
}

/** Whether an item id already exists — the FK precondition for an evidence write. */
export function itemExists(db: Db, id: string): boolean {
  return !!db.prepare("SELECT 1 FROM knowledge_items WHERE id = ?").get(id);
}
