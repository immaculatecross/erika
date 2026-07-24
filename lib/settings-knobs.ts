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
 */
export const ACTIVE_NEW_ITEM_KNOBS: readonly NewItemKnob[] = [
  { key: "newVocabPerDay", label: "Words" },
  { key: "newRulesPerDay", label: "Rules" },
];

/**
 * [P3a] Knobs DEFERRED until a later milestone — rendered inert with a quiet note,
 * never an editable control. The pronunciation ("Sounds") cap can never yield an item
 * until E-37 seeds `phone:` items into the knowledge core, so presenting it as a live
 * control would be a lie (the setting itself is kept so E-37 flips it back on).
 */
export const PENDING_NEW_ITEM_KNOBS: readonly (NewItemKnob & { note: string })[] = [
  { key: "newPronPerDay", label: "Sounds", note: "arrives with pronunciation studio" },
];
