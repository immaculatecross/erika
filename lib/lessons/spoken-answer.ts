// ─────────────────────────────────────────────────────────────────────────────
// GRADING A SPOKEN ANSWER (E-45 criterion 2, D-28).
//
// Client-safe and PURE: no DB, no network, and — the point — NO MODEL CALL. A
// drill has a known correct answer, so judging it is string comparison, not
// judgement. The billed `rewrite` grader this replaces asked a model whether a
// learner's sentence was "correct and natural"; it is deleted.
//
// D-28 is what permits speech-to-text here at all, and it is narrow: a drill is
// SCRIPTED assessment with a known answer (D-21's standing allowance), so
// transcribing it is not D-3's banned "transcribe speech to find errors". Nothing
// spontaneous is ever transcribed by this path.
//
// ── THE RULE THAT MATTERS MORE THAN THE OTHERS ───────────────────────────────
//
// This product's user is an advanced speaker with an accent. Marking a correct
// answer wrong is the most corrosive thing a language app can do to them — it is
// worse than missing an error, because it teaches them to distrust the app and
// then to distrust themselves. Everything below is shaped by that:
//
//   * normalization is GENEROUS about what a transcript cannot be trusted to get
//     right (case, punctuation, accents, elision, spacing, leading filler);
//   * matching is STRICT about what actually distinguishes two Italian words. In
//     particular there is deliberately NO edit-distance tolerance. A one-character
//     difference in Italian is very often exactly the error under test —
//     `gatto`/`gatta`, `parlo`/`parlò`, `fossi`/`fosse` — so "close enough" would
//     mark the error correct, which is the same betrayal pointing the other way;
//   * and because normalization alone can never make a transcript trustworthy, the
//     runner gives the learner the last word. See MISHEARD_STREAK_TO_FALL_BACK.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many consecutive "that is not what I said" overrides switch the rest of the
 * session to tapping.
 *
 * Three, and the reasoning is about what each number means to the learner. Once is
 * noise — every recogniser mishears sometimes. Twice could still be noise. Three in
 * a row is not the learner having bad luck, it is speech recognition not working
 * for this voice, in this room, today; continuing to offer it is asking them to
 * keep failing at something we already know is broken. So the app stops asking,
 * says so plainly once, and finishes the session on the click path — which every
 * drill already has. Nothing is lost: the drills are the same drills.
 */
export const MISHEARD_STREAK_TO_FALL_BACK = 3;

/**
 * Italian accented vowels folded to their bare letters.
 *
 * Accents are meaning-bearing in Italian (`e` "and" vs `è` "is"; `parlo` vs
 * `parlò`), so folding them loses a real distinction — and we do it anyway,
 * deliberately, because a speech-to-text transcript is not a reliable witness to
 * an accent it never heard as a separate sound. The learner SAID the right word;
 * refusing them because the recogniser typed `perche` for `perché` would be
 * punishing them for the tool. The accented form is still what we show as the
 * answer, so nothing is taught wrong.
 */
const ACCENT_FOLD: Readonly<Record<string, string>> = {
  à: "a", á: "a", è: "e", é: "e", ì: "i", í: "i", ò: "o", ó: "o", ù: "u", ú: "u",
};

/**
 * Filler a learner says before the answer proper and a transcript faithfully
 * records: "ehm, sono andato". Stripping it is not leniency about Italian, it is
 * refusing to grade hesitation as content.
 */
const LEADING_FILLER = /^(?:ehm|eh|mmm|mm|uhm|uh|allora|dunque|beh|boh)\b[\s,]*/i;

/**
 * Normalize an utterance for comparison. Stated as rules so each is testable on
 * its own, in the order applied:
 *
 *  1. lowercase;
 *  2. fold accented vowels to bare vowels (see ACCENT_FOLD);
 *  3. apostrophes — typographic and straight — become spaces, so the elision a
 *     transcript may write three different ways (`l'amico`, `l' amico`, `lamico`
 *     → the first two both become `l amico`) stops being three answers;
 *  4. every remaining non-letter, non-digit becomes a space, which disposes of
 *     punctuation a speaker never uttered and a recogniser invented;
 *  5. collapse runs of whitespace and trim;
 *  6. strip leading filler.
 */
export function normalizeSpoken(s: string): string {
  const folded = s
    .toLowerCase()
    .replace(/[àáèéìíòóùú]/g, (c) => ACCENT_FOLD[c] ?? c)
    .replace(/['’`´]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return folded.replace(LEADING_FILLER, "").trim();
}

/** `normalizeSpoken`, kept under the name the older exercise code used. */
export function normalizeAnswer(s: string): string {
  return normalizeSpoken(s);
}

/**
 * Whether `heard` contains `target` as a whole run of tokens.
 *
 * This is the one real tolerance, and it is about how people answer rather than
 * about how they pronounce. Asked to fill "vado ____ centro" a learner very often
 * says the whole sentence — "vado al centro" — and a bare equality check would
 * mark that wrong for being MORE right than required. Whole-token matching (not
 * substring) is what keeps it honest: "al" matches "vado al centro" but does not
 * match "vado alcentro" or "il palo".
 */
export function containsTokens(heard: string, target: string): boolean {
  const h = heard.split(" ").filter(Boolean);
  const t = target.split(" ").filter(Boolean);
  if (t.length === 0 || t.length > h.length) return false;
  for (let i = 0; i + t.length <= h.length; i++) {
    if (t.every((tok, j) => h[i + j] === tok)) return true;
  }
  return false;
}

/**
 * Grade a spoken answer against the drill's answer key. Deterministic, no model
 * call, and no fuzzy matching (see this module's header for why fuzzy matching is
 * refused rather than merely absent).
 *
 * Correct when, after normalization, the transcript IS the target or CONTAINS the
 * target as a whole run of tokens.
 */
export function gradeSpokenAnswer(answer: string, heard: string): boolean {
  const target = normalizeSpoken(answer);
  const said = normalizeSpoken(heard);
  if (target === "" || said === "") return false;
  return said === target || containsTokens(said, target);
}
