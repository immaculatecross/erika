import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { getIncludedFinding } from "../findings-model";
import { attestsLemma } from "../lexicon/morphit";
import { UnvalidatedLemmaError, itemExists, parseItemId } from "./items";
import { rebuildItem } from "./derive";
import { evidenceWeight, type Evidence, type EvidenceInput, type EvidenceMode } from "./types";

// The append-only evidence log's write path (E-25, D-19). `recordEvidence` is the
// one door: it validates the item id (the D-19 canonical-lemma gate again — an
// unvalidated lemma is refused here too, so no evidence row can carry one),
// appends the row, and re-derives the item's cache from the whole log. There is no
// update/delete API — and the `evidence` table's triggers reject those at the SQL
// level, so append-only holds even against a stray direct write.
//
// `bridgeFinding` is the findings → evidence bridge. It reads the finding
// EXCLUSIVELY through lib/findings-model.ts's included-finding scope (E-17, the one
// findings gate — no competing predicate here) and writes an audio-derived,
// finding-sourced evidence row. The deep pass that attaches a validated lemma id to
// a finding is E-28; this milestone builds the bridge and leaves the caller to
// supply the item.

interface EvidenceRow {
  id: string;
  item_id: string;
  source: Evidence["source"];
  source_ref: string | null;
  polarity: 0 | 1;
  mode: EvidenceMode;
  weight: number;
  session_id: string | null;
  created_at: string;
}

function toEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id,
    itemId: r.item_id,
    source: r.source,
    sourceRef: r.source_ref,
    polarity: r.polarity,
    mode: r.mode,
    weight: r.weight,
    sessionId: r.session_id,
    createdAt: r.created_at,
  };
}

export function getEvidence(db: Db, id: string): Evidence | null {
  const r = db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) as EvidenceRow | undefined;
  return r ? toEvidence(r) : null;
}

/**
 * Append one observation to the log and re-derive its item's cache. Refuses an
 * unvalidated lemma id (the item write path's morph-it gate, enforced here too) and
 * an unknown item (the FK precondition). `weight` is computed from mode + audio, not
 * taken on trust. `createdAt` may be supplied (backfill / deterministic tests);
 * otherwise SQLite stamps `datetime('now')`.
 */
export function recordEvidence(db: Db, input: EvidenceInput & { createdAt?: string }): Evidence {
  const parsed = parseItemId(input.itemId);
  if (parsed.kind === "lemma") {
    if (!parsed.lemma || !parsed.pos || !attestsLemma(parsed.lemma, parsed.pos)) {
      throw new UnvalidatedLemmaError(parsed.lemma ?? input.itemId, parsed.pos ?? "?");
    }
  }
  if (!itemExists(db, input.itemId)) {
    throw new Error(`No knowledge item ${input.itemId} to attach evidence to.`);
  }

  const weight = evidenceWeight(input.mode, input.audioDerived);
  const id = randomUUID();
  const tx = db.transaction(() => {
    if (input.createdAt) {
      db.prepare(
        `INSERT INTO evidence (id, item_id, source, source_ref, polarity, mode, weight, session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.itemId, input.source, input.sourceRef ?? null, input.polarity, input.mode, weight, input.sessionId ?? null, input.createdAt);
    } else {
      db.prepare(
        `INSERT INTO evidence (id, item_id, source, source_ref, polarity, mode, weight, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.itemId, input.source, input.sourceRef ?? null, input.polarity, input.mode, weight, input.sessionId ?? null);
    }
    rebuildItem(db, input.itemId);
  });
  tx();
  return getEvidence(db, id)!;
}

/**
 * Append one PRODUCED-LEMMA positive (E-28) idempotently (E-36, closes a RETRO-002
 * item). Produced positives are minted per (session, segment, lemma) once, ever: the
 * `sourceRef` is that stable idempotency key and a partial UNIQUE index
 * (idx_evidence_produced_idem) enforces it, so re-running a deep-listen on the same
 * segment re-emits the same key and this write is a no-op. It uses `INSERT OR IGNORE`
 * — append-only-COMPATIBLE (a skipped insert, never the UPDATE/DELETE the v14 triggers
 * reject). Returns whether a NEW row was actually appended (false = deduped), so the
 * caller keeps its yield counters honest. The item cache is rebuilt only on a real
 * append. Refuses an unvalidated lemma id and an unknown item, exactly like
 * `recordEvidence` — the same morph-it gate, enforced here too.
 */
export function recordProducedEvidence(
  db: Db,
  input: { itemId: string; sessionId: string; sourceRef: string },
): boolean {
  const parsed = parseItemId(input.itemId);
  if (parsed.kind === "lemma") {
    if (!parsed.lemma || !parsed.pos || !attestsLemma(parsed.lemma, parsed.pos)) {
      throw new UnvalidatedLemmaError(parsed.lemma ?? input.itemId, parsed.pos ?? "?");
    }
  }
  if (!itemExists(db, input.itemId)) {
    throw new Error(`No knowledge item ${input.itemId} to attach evidence to.`);
  }
  const weight = evidenceWeight("spontaneous", true); // discounted spontaneous-correct
  const id = randomUUID();
  let appended = false;
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO evidence (id, item_id, source, source_ref, polarity, mode, weight, session_id)
         VALUES (?, ?, 'finding', ?, 1, 'spontaneous', ?, ?)`,
      )
      .run(id, input.itemId, input.sourceRef, weight, input.sessionId);
    if (info.changes > 0) {
      appended = true;
      rebuildItem(db, input.itemId);
    }
  });
  tx();
  return appended;
}

/**
 * Bridge one finding to an evidence row on `itemId`. The finding is read through
 * the E-17 included-finding scope ONLY — a finding outside it (its audio carries no
 * complete analysis witness) is refused, never quietly written. Findings come from
 * recordings, so the evidence is audio-derived (the ×0.7 weight discount applies);
 * the caller states the mode and polarity (E-28 supplies the validated lemma).
 */
export function bridgeFinding(
  db: Db,
  findingId: string,
  target: { itemId: string; polarity: 0 | 1; mode: EvidenceMode },
): Evidence {
  const finding = getIncludedFinding(db, findingId);
  if (!finding) throw new Error(`Finding ${findingId} is not an included finding (E-17 scope).`);
  return recordEvidence(db, {
    itemId: target.itemId,
    source: "finding",
    sourceRef: findingId,
    polarity: target.polarity,
    mode: target.mode,
    audioDerived: true,
    sessionId: finding.sessionId,
  });
}
