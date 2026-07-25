// Client-safe view model for the flashcard drill (E-5), mirroring the split in
// lib/analysis-view.ts: no Node/better-sqlite3 imports live here, so the Practice
// page, the practice runner, and the API routes share one card shape and the one
// list of grade buttons. The server route reduces a full lib/cards.ts Card to a
// CardView (dropping the SM-2/session plumbing the drill never renders).
//
// Correction-forward, error-once (E-29, D-18): the card a user drills is
// meaning-first. The *front* is the retrieval cue toward the CORRECT form — an
// Italian context gap (the correct utterance with the changed span blanked) — and
// never the user's error. The *correction* is the retrieval target, headlined on
// the back with the `why`, and the original `error` appears exactly once there,
// subordinate and marked. All of it is re-derived from the finding's fields at
// display time (`deriveFaces`), with no model call and no stored-shape change.
//
// ─────────────────────────────────────────────────────────────────────────────
// [E-45] THE INVARIANT THIS FILE EXISTS TO HOLD
//
//   Every card front is answerable by a learner who has never seen the finding it
//   came from — because that is every learner.
//
// It was violated by construction. `deriveFront` used to take the finding's
// `category` and, whenever the correction shared no leading OR trailing token with
// the quote (or the correction was a pure deletion), return `"____ · grammar"`.
// That is not an edge case: it is EVERY single-word fix ("gatto" → "gatta", which
// has no context at all) and EVERY whole-sentence rewrite (the normal shape of
// `phrasing` and `idiom`). components/flashcard.tsx then printed the category a
// second time above it, so the learner read GRAMMAR over "____ · grammar" and was
// asked to recall something unrecallable.
//
// The fix is structural rather than a new branch, because a new branch would have
// the same failure mode as the old one:
//
//   1. `deriveFront` NO LONGER TAKES `category`. A bare category word cannot be
//      produced by a function that is not given one — this is the totality proof
//      for "no card front is ever a bare category word", and it is checked by the
//      type system rather than by a test that could rot.
//   2. `deriveFront` RETURNS `string | null`. `null` means "this finding's fields
//      cannot produce an answerable cue" — it is not a card. That case routes the
//      way a `pronunciation` finding already routes (E-37): the finding is as
//      included as it ever was, fully present in the Phrasebook, the Archive and
//      the report; it simply is not this format.
//   3. Every non-null front is built ONLY from tokens of the CORRECTION, so the
//      learner's error can never appear in a stimulus (D-18), and it carries at
//      least MIN_CONTEXT_WORDS words of correct Italian around exactly one blank
//      standing for at most MAX_TARGET_WORDS words.
//
// `frontIsAnswerable` states (3) as a checkable predicate so the property test can
// assert it over synthetic findings rather than over the strings this file happens
// to produce today.
// ─────────────────────────────────────────────────────────────────────────────

import type { Grade } from "./srs";

export type { Grade } from "./srs";

/** The blank standing in for the blanked-out retrieval target in a context-gap front. */
export const CLOZE_BLANK = "____";

/**
 * How many words of CORRECT target-language context a front must keep around the
 * blank. Two is the floor because one is demonstrably not enough: a register slip
 * ("Non voglio" → "Non desidero") leaves the single word "Non", and `Non ____` is
 * a prompt with a thousand answers — the same unanswerable card in a politer
 * costume. Two content-bearing words is the smallest cue that constrains the gap
 * to a grammatical slot ("vado ____ centro", "____ andato al cinema").
 */
export const MIN_CONTEXT_WORDS = 2;

/**
 * The widest span a blank may hide. Beyond four words the learner is being asked
 * to reproduce a sentence they have never been shown, which is the whole-rewrite
 * failure — `phrasing` and `idiom` corrections are usually this shape. A gap that
 * wide is not a retrieval cue, it is a memory test of something never presented.
 */
export const MAX_TARGET_WORDS = 4;

/**
 * A card reduced to what the drill shows, correction-forward (E-29). The `front`
 * is the meaning-first cue (never the raw error); `correction` is the retrieval
 * target headlined on the back; `why` is the reason; `error` is the user's own
 * utterance, shown once on the back and marked. `findingId` lets the back's Compare
 * control (E-21) render — the rendition route resolves timing/correction from it.
 */
export interface CardView {
  id: string;
  findingId: string;
  category: string;
  front: string;
  correction: string;
  why: string;
  error: string;
}

/**
 * A card reduced to what the browser lists (E-5b): the drill faces plus its
 * schedule-visible state — `due` (a SQLite UTC timestamp) and whether it is
 * suspended. Still client-safe: no SM-2 internals or session plumbing leak out.
 */
export interface CardBrowserView {
  id: string;
  category: string;
  front: string;
  correction: string;
  why: string;
  error: string;
  due: string;
  suspended: boolean;
}

/** The four faces a finding resolves to for display (E-29). Pure — no DB, no model. */
export interface CardFaces {
  /** The meaning-first stimulus: a context gap toward the correct form. Never
   *  contains the user's raw error, and never a bare category word. */
  front: string;
  /** The correct form — the retrieval target, headlined on the back. */
  correction: string;
  /** The reason (explanation), possibly empty. */
  why: string;
  /** The user's original erroneous utterance — shown once on the back, marked. */
  error: string;
}

/** Split an utterance into whitespace-delimited tokens (empties dropped). */
function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter((t) => t.length > 0);
}

/** Normalize a token for the cloze diff: lowercase and strip surrounding
 *  punctuation, so "andato." / "Andato" / "andato" are one word (Italian accents
 *  are letters under \p{L}). */
function normToken(t: string): string {
  return t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Whether a token carries any letter or digit at all — bare punctuation ("—", ",")
 *  is not a word of context, and counting it as one is how `Non ____` passed. */
function isWord(t: string): boolean {
  return normToken(t).length > 0;
}

/**
 * [E-45, Amendment 1 — THE TIE-BREAK] Whether a finding corrected no text at all.
 *
 * `lib/mistakes.ts` deliberately places a blurred/centralised final vowel in BOTH
 * class A (grammar agreement — cardable) and class C (pronunciation — uncardable),
 * because it genuinely is both: the ending IS the gender marker, and an ending
 * swallowed until -o and -a cannot be told apart is that same error heard rather
 * than spelled. A model that hears it may label it either way, and when it labelled
 * it `grammar` the card path minted a card whose front was "____ · grammar" and
 * whose ANSWER WAS THE WORD THE LEARNER ALREADY SAID.
 *
 * The tie-break is decided here, deterministically, and does not depend on which
 * branch of the cascade ran first: **a finding whose correction is textually
 * identical to its quote corrected no text, so whatever was wrong was the SOUND.**
 * It resolves to the pronunciation class and is not cardable — which is exactly how
 * an explicitly-labelled `pronunciation` finding has been treated since E-37, so the
 * two labels now reach the same place instead of two different ones.
 *
 * Scope note: this decides CARD FORMAT only. It changes no findings gate, no
 * analysis output, and no other surface's set (E-45 Amendment 3 freezes
 * lib/findings-model.ts) — the finding stays in the Phrasebook, the Archive and the
 * report exactly as before.
 */
export function isPronunciationArtifact(quote: string, correction: string): boolean {
  const q = tokenize(quote).map(normToken).filter((t) => t.length > 0);
  const c = tokenize(correction).map(normToken).filter((t) => t.length > 0);
  return q.length === c.length && q.every((t, i) => t === c[i]);
}

/**
 * Whether `front` is an answerable cue for `correction` — the invariant, stated as
 * a predicate so it can be asserted over synthetic findings instead of over the
 * strings this module happens to emit today.
 *
 * Answerable means all of: exactly one blank; at least MIN_CONTEXT_WORDS words of
 * context around it; every context token is a token of the CORRECTION (so no error
 * text and no editorial word — including a category name — can appear); and the
 * blank stands for between 1 and MAX_TARGET_WORDS words.
 */
export function frontIsAnswerable(front: string, correction: string): boolean {
  const tokens = tokenize(front);
  const blanks = tokens.filter((t) => t === CLOZE_BLANK);
  if (blanks.length !== 1) return false;

  const context = tokens.filter((t) => t !== CLOZE_BLANK);
  if (context.filter(isWord).length < MIN_CONTEXT_WORDS) return false;

  const fromCorrection = new Set(tokenize(correction).map(normToken));
  if (!context.every((t) => fromCorrection.has(normToken(t)))) return false;

  const hidden = tokenize(correction).length - context.length;
  return hidden >= 1 && hidden <= MAX_TARGET_WORDS;
}

/**
 * Derive the meaning-first front (E-29, D-18): a context gap toward the correct
 * form. Diff the error against the correction by shared prefix/suffix words; the
 * span of the *correction* that differs is the retrieval target, blanked out, so
 * the surrounding correct Italian is the cue and the user must produce the correct
 * form. The error never appears. No model call.
 *
 * Returns `null` — never a category prompt — when the finding's fields cannot
 * produce an answerable cue. The four ways that happens are the four ways a card
 * used to become unanswerable, and each is now a refusal rather than a degradation:
 *
 *   (a) nothing textual was corrected (a pronunciation artifact, whatever the
 *       stored category says — see `isPronunciationArtifact`);
 *   (b) the correction is a pure deletion, so there is no target to retrieve;
 *   (c) the changed span is wider than MAX_TARGET_WORDS — a whole-sentence rewrite,
 *       the normal shape of `phrasing` and `idiom`;
 *   (d) fewer than MIN_CONTEXT_WORDS words of correct context survive around the
 *       gap — a single-word fix ("gatto" → "gatta") has none at all, and a register
 *       slip ("Non voglio" → "Non desidero") has one.
 *
 * NOTE the signature: `category` is deliberately NOT a parameter. A function that
 * is never handed a category cannot emit one, which is the whole of the proof that
 * no front is ever a bare category word.
 */
export function deriveFront(quote: string, correction: string): string | null {
  // (a) No text changed — the sound was the error, not the spelling.
  if (isPronunciationArtifact(quote, correction)) return null;

  const q = tokenize(quote);
  const c = tokenize(correction);
  const qn = q.map(normToken);
  const cn = c.map(normToken);

  let prefix = 0;
  while (prefix < qn.length && prefix < cn.length && qn[prefix] === cn[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < qn.length - prefix &&
    suffix < cn.length - prefix &&
    qn[qn.length - 1 - suffix] === cn[cn.length - 1 - suffix]
  ) {
    suffix++;
  }

  const before = c.slice(0, prefix);
  const after = suffix > 0 ? c.slice(c.length - suffix) : [];
  const targetLen = c.length - prefix - suffix;

  // (b) Nothing to retrieve: the correction only removed words.
  if (targetLen <= 0) return null;
  // (c) The gap is a sentence, not a slot.
  if (targetLen > MAX_TARGET_WORDS) return null;
  // (d) Not enough correct context to constrain the answer.
  if ([...before, ...after].filter(isWord).length < MIN_CONTEXT_WORDS) return null;

  return [...before, CLOZE_BLANK, ...after].join(" ");
}

/**
 * Resolve a finding's fields to the four display faces (E-29), or `null` when the
 * finding cannot produce an answerable front (E-45). Re-derived at display time —
 * no stored shape changes, so existing cards flip too, and a legacy card whose
 * front would degrade simply stops being shown (lib/cards.ts retires it).
 */
export function deriveFaces(
  quote: string,
  correction: string,
  explanation: string,
): CardFaces | null {
  const front = deriveFront(quote, correction);
  if (front === null) return null;
  return { front, correction, why: explanation, error: quote };
}

// The stored `cards.back` column still holds the correction + reason (written at
// generation), separated by a blank line. Display no longer reads it — faces are
// re-derived from the finding — but generation keeps writing it (no migration), and
// `splitBack` remains the reader for that column and the CSV/legacy paths.
const BACK_SEPARATOR = "\n\n";

/** Build a card's stored back text from a finding's correction and explanation. */
export function cardBack(correction: string, explanation: string): string {
  return `${correction}${BACK_SEPARATOR}${explanation}`;
}

/** Split a stored back into its recast and (possibly empty) reason. */
export function splitBack(back: string): { recast: string; why: string } {
  const [recast, ...rest] = back.split(BACK_SEPARATOR);
  return { recast, why: rest.join(BACK_SEPARATOR) };
}

/** The four grade buttons, in Again → Easy order, with their 1–4 shortcut keys. */
export const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

const KEY_TO_GRADE: Record<string, Grade> = Object.fromEntries(
  GRADES.map(({ key, grade }) => [key, grade]),
);

/** The grade a "1"–"4" keypress selects, or null for any other key. */
export function gradeForKey(key: string): Grade | null {
  return KEY_TO_GRADE[key] ?? null;
}

/** Whether an untrusted value is one of the four grades (route input guard). */
export function isGrade(v: unknown): v is Grade {
  return typeof v === "string" && GRADES.some((g) => g.grade === v);
}
