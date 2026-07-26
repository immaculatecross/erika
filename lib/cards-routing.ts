import { deriveFront, isPronunciationArtifact } from "./cards-view";

// ---- what cannot become a card (E-37, tightened at E-45) --------------------
//
// A card's front is derived by diffing the error against the correction
// (`deriveFront`), so it needs a localized textual change to cue from. A PRONUNCIATION
// finding has none — the spelling was never wrong — so the front degrades to a bare
// "____ · pronunciation": a prompt nobody can answer, and precisely the defect
// RETRO-003 named. Such findings belong to the pronunciation studio, where the learner
// hears the correct line and says it back.
//
// This is a routing decision about a card's FORMAT, not a second findings gate: the
// finding is as included as it ever was, and it is fully present in the Phrasebook, the
// Archive and the report. One constant serves BOTH card paths — bulk generation and the
// deliberate pin — so neither can produce an unanswerable card.
//
// [E-45] E-37 fixed the INSTANCE (one category) and not the INVARIANT. The category is
// only one of the ways a finding fails to yield an answerable cue, and it was not even
// the common one: every single-word fix and every whole-sentence rewrite failed too,
// under any category. So cardability is now asked of the finding's SHAPE — the same
// question `deriveFront` answers — and the category set survives only as the cheap
// pre-filter that keeps a pronunciation finding out of the deck even in the rare case
// where its correction happens to be textually localized.

/**
 * WHY a finding cannot become a card — and the two answers are genuinely different
 * to a learner, so the pin route must be able to tell them apart.
 *
 *   `pronunciation`        — the words were right and the sound was not. There IS a
 *                            surface for this: the studio, where you hear the line
 *                            and say it back. "Practise it in the studio."
 *   `no_answerable_front`  — the correction has no localized change to cue from (a
 *                            whole-sentence rewrite, a single-word fix, a register
 *                            slip). There is no drill for it; it stays in the
 *                            Phrasebook, which is where it is useful.
 *
 * [E-45] Before this split, every refusal was reported as a pronunciation routing,
 * so pinning a `phrasing` rewrite answered "This one is about how it sounds" — which
 * is simply false. Widening the refusal without widening the reason would have
 * shipped a new piece of dishonest copy in a milestone about honesty.
 */
export type UncardableReason = "pronunciation" | "no_answerable_front";

export const UNCARDABLE_CATEGORIES: ReadonlySet<string> = new Set(["pronunciation"]);

/** Whether a finding of this category can become an answerable card. */
export function isCardable(category: string): boolean {
  return !UNCARDABLE_CATEGORIES.has(category);
}

/**
 * [E-45] Whether this finding can become an ANSWERABLE card — the whole test, in one
 * place, used by bulk generation, the deliberate pin, and the retirement sweep, so no
 * path can mint or keep a card the learner cannot answer.
 *
 * Two clauses, and both are load-bearing:
 *   - the category is cardable (E-37 — a pronunciation finding goes to the studio);
 *   - the fields yield a front (`deriveFront` is not null), which also decides the
 *     Amendment-1 tie-break: a finding whose correction changed no text is a
 *     pronunciation artifact whatever its stored category says.
 */
export function findingIsCardable(f: { category: string; quote: string; correction: string }): boolean {
  return isCardable(f.category) && deriveFront(f.quote, f.correction) !== null;
}

/**
 * [E-45, Amendment 1 — THE TIE-BREAK, where it has observable effect] Which class an
 * uncardable finding belongs to.
 *
 * `lib/mistakes.ts` deliberately places a blurred/centralised final vowel in BOTH
 * class A (grammar agreement) and class C (pronunciation), because it genuinely is
 * both: in Italian the ending IS the gender marker, and an ending swallowed until -o
 * and -a cannot be told apart is that same error heard rather than spelled. A model
 * may label it either way, and the reviewer of PR #66 drove a real cascade in which
 * it came back `grammar` and minted a card fronted "____ · grammar" whose ANSWER WAS
 * THE WORD THE LEARNER ALREADY SAID.
 *
 * The tie-break is decided here and does not depend on which branch ran first:
 * **a finding whose correction is textually identical to its quote corrected no text,
 * so whatever was wrong was the SOUND** — it resolves to the pronunciation class
 * whatever the stored category says. That is the same place an explicitly-labelled
 * pronunciation finding lands, so the two labels now reach ONE answer instead of two.
 *
 * This is where the rule earns its keep rather than in `deriveFront`, where clause
 * (b) already refuses the same input for a different reason: here it decides what the
 * learner is TOLD and where they are SENT — the studio, which can actually drill it,
 * rather than "it stays in your phrasebook".
 *
 * Scope note: card routing only. No findings gate, no analysis output and no other
 * surface's set changes (Amendment 3 freezes lib/findings-model.ts).
 */
export function uncardableReason(f: { category: string; quote: string; correction: string }): UncardableReason {
  if (!isCardable(f.category)) return "pronunciation";
  return isPronunciationArtifact(f.quote, f.correction) ? "pronunciation" : "no_answerable_front";
}

/** The SQL form of `isCardable`, built from the same constant. The values are internal
 *  literals from the closed `CATEGORIES` vocabulary, never user input. */
export const CARDABLE_CATEGORY_SQL = `f.category NOT IN (${[...UNCARDABLE_CATEGORIES]
  .map((c) => `'${c}'`)
  .join(", ")})`;
