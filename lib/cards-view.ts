// Client-safe view model for the flashcard drill (E-5), mirroring the split in
// lib/analysis-view.ts: no Node/better-sqlite3 imports live here, so the Practice
// page, the practice runner, and the API routes share one card shape and the one
// list of grade buttons. The server route reduces a full lib/cards.ts Card to a
// CardView (dropping the SM-2/session plumbing the drill never renders).

import type { Grade } from "./srs";

export type { Grade } from "./srs";

/** A card reduced to what the drill shows: its two faces and its category. */
export interface CardView {
  id: string;
  front: string;
  back: string;
  category: string;
}

// Front is the phrase in context; back is the correction, then the "why",
// separated by a blank line so the runner can show the recast above the reason.
// These live here (not lib/cards.ts) so the client flashcard can split a back
// without pulling in the server-only, node:crypto data layer.
const BACK_SEPARATOR = "\n\n";

/** Build a card's back text from a finding's correction and explanation. */
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
