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

import type { Grade } from "./srs";

export type { Grade } from "./srs";

/** The blank standing in for the blanked-out retrieval target in a context-gap front. */
export const CLOZE_BLANK = "____";

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
  /** The meaning-first stimulus: a context gap toward the correct form, or a
   *  category-cued prompt. Never contains the user's raw error. */
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

/**
 * Derive the meaning-first front (E-29, D-18): a context gap toward the correct
 * form. Diff the error against the correction by shared prefix/suffix words; the
 * span of the *correction* that differs is the retrieval target, blanked out, so
 * the surrounding correct Italian is the cue and the user must produce the correct
 * form. The error never appears. No model call.
 *
 * Degrades when there is no localized change to cue from — a whole-sentence
 * rewrite, a single-token correction, an identical recast (e.g. a pronunciation
 * flag where spelling is unchanged) — to a category-cued prompt that still shows
 * no error text and still hides the target.
 */
export function deriveFront(quote: string, correction: string, category: string): string {
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

  // A localized correction leaves correct context around the changed span: blank
  // the changed span (the retrieval target) and keep the context as the cue.
  if (targetLen > 0 && (before.length > 0 || after.length > 0)) {
    return [...before, CLOZE_BLANK, ...after].join(" ");
  }

  // No usable context to cue from without a model — degrade to a category prompt.
  return `${CLOZE_BLANK} · ${category}`;
}

/**
 * Resolve a finding's fields to the four display faces (E-29). The front is the
 * meaning-first cue; the correction is the target; the error is carried through so
 * the back can show it once, marked. Re-derived at display time — no stored shape
 * changes, so existing cards flip too.
 */
export function deriveFaces(
  quote: string,
  correction: string,
  explanation: string,
  category: string,
): CardFaces {
  return {
    front: deriveFront(quote, correction, category),
    correction,
    why: explanation,
    error: quote,
  };
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
