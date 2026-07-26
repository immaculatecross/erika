import type { Db } from "./db";
import { localDay, previousLocalDay, localDayBoundsUtc } from "./local-day";
import { VISIBLE_PLACEMENT_EVIDENCE, currentPlacementRun } from "./knowledge/placement-runs";
import { buildKnowledgeMap, type MapCell } from "./knowledge-map";
import { buildSlipsIndex } from "./slips";
import { parseItemId } from "./knowledge/items";
import { loadSyllabus } from "./syllabus";
import type { ItemKind, KnowledgeStatus } from "./knowledge/types";

// "What Erika knows about you" (E-46 criteria 6, 7). The read model behind the
// progress surface — pure of React, and every figure derived from the knowledge
// core (D-19) or from `computeSlipStandings`, which is the SAME standing Focus
// reduces, so the product keeps one notion of mastery.
//
// THREE HONESTY RULES, each of which this repo has broken before:
//
//  1. NOTHING IS INVENTED. There is no trend, no projection, no "you are on track".
//     Every number below is a count of rows that exist. Where there are no rows the
//     surface says so in words (`hasEvidence: false`) and renders "not started"
//     rather than a fake 0% — the v0.6 review lenses singled this repo's empty
//     states out as genuinely good, and a progress screen is the easiest place to
//     regress them.
//  2. GREEN STAYS MASTERY. Only `map` carries a tint, and it tints only through
//     resolved-slip semantics (lib/knowledge-map.ts, D-24). Counts of activity are
//     ink, never green — heavy practice with nothing resolved must look neutral.
//  3. SUPERSEDED GUESSES DO NOT COUNT. Every evidence read applies
//     `VISIBLE_PLACEMENT_EVIDENCE`, so a placement the learner has since re-taken
//     stops being counted as belief. The dev inspector this surface replaces read
//     `evidence` raw and did count them.
//
// And one thing that is deliberately NOT here: a placement's recognition seeding is
// excluded from "what moved". A guess about which rules a B1 learner has probably
// met is a starting position, not a week's work, and folding hundreds of them into
// a "this week" number would be the single most flattering lie this screen could
// tell.

/** How many local days "this week" reaches back over, inclusive of today. */
export const WEEK_DAYS = 7;

export interface KindProgress {
  kind: ItemKind;
  /** Corroborated production — the D-19 `known` gate. The number that matters. */
  known: number;
  /** Met and being worked on: `introduced` + `learning`. */
  inProgress: number;
  /** Was known and has since slipped. */
  lapsed: number;
}

export interface MovedItem {
  itemId: string;
  kind: ItemKind;
  label: string;
  /** The most recent local day this item saw real (non-placement) evidence. */
  lastDay: string;
  status: KnowledgeStatus;
}

export interface FossilItem {
  id: string;
  category: string;
  correction: string;
  occurrences: number;
  /** Human date of the last time it happened. */
  lastSeenAt: string;
}

export interface ProgressView {
  /** The local day this was built for. */
  day: string;
  /** The level the current placement run claims, or null if never placed. */
  level: string | null;
  /** Whether that placement was trusted enough to state without a caveat. */
  levelCalibrated: boolean;
  /** False when nothing has ever been observed — the whole surface says "not
   *  started" rather than rendering zeroes as if they were measurements. */
  hasEvidence: boolean;
  kinds: KindProgress[];
  /** Items with real evidence in the last WEEK_DAYS local days, most recent first. */
  moved: MovedItem[];
  /** How many distinct items moved — `moved` is capped for display, this is not. */
  movedCount: number;
  /** Recurring mistakes still in the `active` standing: not resolved, not fading. */
  fossilized: FossilItem[];
  map: MapCell[];
}

const KINDS: ItemKind[] = ["lemma", "rule", "phone"];

/** The UTC instant SQLite stores, for a local-day boundary. */
function utcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** The first local day of the window ending on `day`, inclusive. */
export function weekStartDay(day: string, days: number = WEEK_DAYS): string {
  let d = day;
  for (let i = 1; i < days; i++) d = previousLocalDay(d);
  return d;
}

function kindCounts(db: Db): KindProgress[] {
  const rows = db
    .prepare("SELECT kind, status, COUNT(*) AS count FROM knowledge_items GROUP BY kind, status")
    .all() as { kind: string; status: string; count: number }[];
  return KINDS.map((kind) => {
    const of = (status: string) => rows.find((r) => r.kind === kind && r.status === status)?.count ?? 0;
    return {
      kind,
      known: of("known"),
      inProgress: of("introduced") + of("learning"),
      lapsed: of("lapsed"),
    };
  });
}

/** A readable name for an item. Rules get their syllabus title; lemmas their lemma. */
function labelFor(db: Db, itemId: string): string {
  const parsed = parseItemId(itemId);
  if (parsed.kind === "rule") {
    const key = itemId.slice("rule:".length);
    return loadSyllabus().rules.find((r) => r.key === key)?.title ?? key;
  }
  if (parsed.kind === "phone") return itemId.slice("phone:".length);
  return parsed.lemma ?? itemId;
}

/**
 * Items that saw real evidence inside the window. Placement rows are excluded — see
 * the header — and superseded placement rows could not appear anyway.
 */
function movedThisWeek(db: Db, day: string, limit: number): { items: MovedItem[]; count: number } {
  const since = utcStamp(localDayBoundsUtc(weekStartDay(day)).startMs);
  const rows = db
    .prepare(
      `SELECT e.item_id AS itemId, MAX(e.created_at) AS lastAt, i.kind AS kind, i.status AS status
         FROM evidence e
         JOIN knowledge_items i ON i.id = e.item_id
        WHERE e.source <> 'placement'
          AND e.created_at >= ?
          AND ${VISIBLE_PLACEMENT_EVIDENCE}
        GROUP BY e.item_id
        ORDER BY lastAt DESC`,
    )
    .all(since) as { itemId: string; lastAt: string; kind: ItemKind; status: KnowledgeStatus }[];
  return {
    count: rows.length,
    items: rows.slice(0, limit).map((r) => ({
      itemId: r.itemId,
      kind: r.kind,
      label: labelFor(db, r.itemId),
      lastDay: localDay(new Date(`${r.lastAt.replace(" ", "T")}Z`)),
      status: r.status,
    })),
  };
}

/** Recurring mistakes that are still happening — `active`, never in remission. */
function fossilized(db: Db, limit: number): FossilItem[] {
  return buildSlipsIndex(db)
    .slips.filter((s) => s.standing.state === "active")
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      category: s.category,
      correction: s.correction,
      occurrences: s.occurrences,
      lastSeenAt: s.lastSeenAt,
    }));
}

/** Has anything at all ever been observed about this learner? */
function anyEvidence(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM evidence LIMIT 1").get();
}

export function buildProgress(db: Db, day: string = localDay(), movedLimit = 8, fossilLimit = 5): ProgressView {
  const run = currentPlacementRun(db);
  const moved = movedThisWeek(db, day, movedLimit);
  return {
    day,
    level: run?.level ?? null,
    levelCalibrated: run?.calibrated ?? false,
    hasEvidence: anyEvidence(db),
    kinds: kindCounts(db),
    moved: moved.items,
    movedCount: moved.count,
    fossilized: fossilized(db, fossilLimit),
    map: buildKnowledgeMap(db),
  };
}
