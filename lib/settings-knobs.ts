import type { Settings } from "./settings";

// [P3a — trust] The "new items per day" knobs, split into the ones that are live
// controls today and the ones withheld until a later milestone. Client-safe (types +
// constants only, no DB import), so the Settings page renders from it and a unit test
// pins which knobs are active.

/** A numeric new-item-per-day setting key and its short label. */
export interface NewItemKnob {
  key: Extract<keyof Settings, "newVocabPerDay" | "newRulesPerDay" | "newPronPerDay">;
  label: string;
}

/**
 * The knobs that are ACTIVE, editable controls. Vocabulary and grammar items exist in
 * the knowledge core today, so their daily caps do real work.
 *
 * [E-37] "Sounds" JOINS THEM. It was inert because nothing ever created a `phone:`
 * item, so the cap could never yield one ([P3a] withheld it rather than present a lie).
 * The pronunciation studio seeds phones from real drill results — a sound the learner
 * actually missed becomes an item — and surfaces the composer's selection of them, so
 * the cap now governs something that exists (lib/pronunciation/knowledge.ts,
 * lib/pronunciation/studio-view.ts).
 */
export const ACTIVE_NEW_ITEM_KNOBS: readonly NewItemKnob[] = [
  { key: "newVocabPerDay", label: "Words" },
  { key: "newRulesPerDay", label: "Rules" },
  { key: "newPronPerDay", label: "Sounds" },
];

/**
 * [P3a] Knobs DEFERRED until a later milestone — rendered inert with a quiet note,
 * never an editable control. Empty since E-37 flipped "Sounds" on; kept as the
 * mechanism, because the honest way to ship a cap that cannot yet yield anything is to
 * show it as pending rather than as a live control.
 */
export const PENDING_NEW_ITEM_KNOBS: readonly (NewItemKnob & { note: string })[] = [];
