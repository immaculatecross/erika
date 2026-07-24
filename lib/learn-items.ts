import type { Db } from "./db";
import { compose, capsFromSettings } from "./compose";
import { localDay } from "./local-day";
import { parseItemId } from "./knowledge/items";
import { getItem } from "./knowledge/items";
import { loadSyllabus } from "./syllabus";
import { getItemLesson, itemLessonEstimateUsd, posLabel } from "./lessons/item-lessons";
import type { ItemLessonKind, LearnItemSummary } from "./lessons/item-lessons-view";

// The E-32 read-model behind GET /api/learn/items: today's composer-chosen grammar
// and vocabulary items, each an openable micro-lesson. It composes the day's plan
// (the composer's own selection — reviews/slips/findings are practised elsewhere;
// here we surface only the NEW grammar rules and lemmas E-32 generates lessons for),
// annotates each with a display label and an honest price ("Ready" once generated,
// an estimate before), and makes ZERO model calls. The only write is the composer's
// idempotent spill reconciliation, the same read-path materialization buildToday does.

const RULE_KINDS: ReadonlySet<string> = new Set(["vocab", "rule"]);

function labelFor(db: Db, itemId: string, kind: ItemLessonKind): { label: string; detail: string } {
  if (kind === "grammar") {
    const key = itemId.slice("rule:".length);
    const rule = loadSyllabus().rules.find((r) => r.key === key);
    return { label: rule?.title ?? key, detail: rule?.cefr ?? "grammar" };
  }
  const parsed = parseItemId(itemId);
  const item = getItem(db, itemId);
  return { label: parsed.lemma ?? item?.lemma ?? itemId, detail: posLabel(parsed.pos) };
}

export interface LearnItemsView {
  day: string;
  items: LearnItemSummary[];
}

export function buildLearnItems(db: Db, day: string = localDay()): LearnItemsView {
  const plan = compose(db, day, capsFromSettings(db));
  const items: LearnItemSummary[] = [];
  for (const it of plan.items) {
    if (!RULE_KINDS.has(it.kind) || !it.itemId) continue;
    const kind: ItemLessonKind = it.kind === "rule" ? "grammar" : "vocab";
    const hasLesson = getItemLesson(db, it.itemId) !== null;
    const { label, detail } = labelFor(db, it.itemId, kind);
    items.push({
      itemId: it.itemId,
      kind,
      label,
      detail,
      hasLesson,
      estimateUsd: hasLesson ? null : itemLessonEstimateUsd(db, it.itemId),
    });
  }
  return { day, items };
}
