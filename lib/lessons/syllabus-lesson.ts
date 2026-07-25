import { loadSyllabus, ruleKeyToItemId, type SyllabusRule } from "../syllabus";
import { trimToBudget, MAX_DRILLS, MAX_EXAMPLES, MIN_DRILLS } from "./lesson-budget";
import type { ItemExercise, ItemLesson } from "./item-lessons-view";

// ─────────────────────────────────────────────────────────────────────────────
// THE LESSON THAT ALWAYS EXISTS (E-45 criterion 1, D-27).
//
// D-27 inverted D-17: *"the backbone should be your lessons, like Duolingo"* —
// the E-26 syllabus is the spine of the daily lesson and the learner's recordings
// are the overlay. The consequence that matters is a requirement, not a fallback:
// **a database with no recordings, no findings, no slips and no API key must still
// produce a complete lesson**, because that is what every learner has on day one
// and what this one has on any day they did not record.
//
// So this module builds a whole lesson — explanation, worked examples, and real
// answerable drills — from the shipped syllabus alone. No model call, no network,
// no key, no cost, no cache, no latency. It is the PRIMARY path; the generated
// lesson is an enrichment on top of it, and every failure of that enrichment lands
// back here rather than on an error screen.
//
// ── How the drills are made, and why this way ────────────────────────────────
//
// Every syllabus rule ships with two correct Italian examples chosen to ILLUSTRATE
// THE SAME RULE. That is a stronger asset than it looks: the words that differ
// between two sentences demonstrating one rule are exactly the words the rule is
// about. `mi piace` / `ti piacciono`, `Ho corso` / `Sono corso`, `c'è` / `ci sono`.
//
// So a drill is: blank the most rule-bearing word of one example, and offer the
// corresponding word from the other example as the distractor. Both options are
// real Italian, exactly one fits, and the contrast IS the lesson. Nothing is
// invented, so nothing can be invented wrongly — which is the failure mode a model
// would have here and the reason this path does not need one.
//
// "Most rule-bearing" is a heuristic, stated plainly: among the words unique to
// this example, prefer one that has a near-twin in the other example (`piace` /
// `piacciono` share four letters — an inflection contrast), then prefer the
// shorter word, because in Italian the grammar lives in the short words. It is a
// heuristic and it is allowed to be one: whichever word is blanked, the options
// are real, the answer is correct, and the rationale states the rule.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Examples that are word-lists rather than sentences — "palla vs pala",
 * "casa: c-a-s-a". Blanking a word in one produces a nonsense cue, so these rules
 * simply yield no deterministic drill and the picker moves to the next rule. 222
 * of the syllabus's 266 rules produce drills; refusing the other 44 is much better
 * than shipping "palla vs ____".
 */
const CONTRAST_FORM = /(\svs\s|\s\/\s|:|—|\|)/;

/** Options offered per drill, target included. Three is the most a phone shows
 *  comfortably and the fewest distractors that still require knowing the rule. */
export const DRILL_OPTIONS = 3;

/** The blank a gap drill shows — the same constant the card fronts use. */
const CLOZE_BLANK = "____";

const tokens = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

/** Every WORD a rendered cue puts on screen, split on any non-letter so a word
 *  hiding inside another ("cinquant'anni" → cinquant, anni) is still seen. */
const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A token stripped to its letters/digits, for comparison. */
const norm = (t: string): string => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** An option as it is DISPLAYED: without the sentence punctuation that happened to
 *  sit beside it ("caffè." is not a word the learner is choosing). */
const asOption = (t: string): string => t.replace(/^[^\p{L}\p{N}'’]+|[^\p{L}\p{N}'’]+$/gu, "");

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** The tokens of `example` that appear in no other example of the same rule. */
function uniqueTokens(example: string, others: readonly string[]): string[] {
  const elsewhere = new Set(others.flatMap((e) => tokens(e).map(norm)));
  const seen = new Set<string>();
  return tokens(example).filter((t) => {
    const n = norm(t);
    if (!n || elsewhere.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

/** Rank candidate tokens by how much they look like the rule's own contrast:
 *  a near-twin in the rival set first, then the shorter word, then alphabetically
 *  so the output is stable across runs (a lesson must not reshuffle on reload). */
function rankByRuleSalience(candidates: readonly string[], rivals: readonly string[]): string[] {
  const twin = (t: string) => Math.max(0, ...rivals.map((r) => sharedPrefix(norm(t), norm(r))));
  return [...candidates].sort((a, b) => {
    const [ta, tb] = [twin(a), twin(b)];
    if (ta !== tb) return tb - ta;
    if (norm(a).length !== norm(b).length) return norm(a).length - norm(b).length;
    return norm(a) < norm(b) ? -1 : 1;
  });
}

/** Whether `option` fits the slot's capitalization — a distractor that is
 *  capitalized in the middle of a sentence gives the answer away for free. */
function capitalizationFits(option: string, target: string, gapIsSentenceStart: boolean): boolean {
  const upper = (s: string) => /^\p{Lu}/u.test(s);
  return gapIsSentenceStart ? true : upper(option) === upper(target);
}

/**
 * Build the contrast drills for one rule, or `[]` when its examples cannot make
 * one. `invite` alternates so a lesson always offers both ways to answer — the
 * first drill is tapped (nothing to learn about the interface), the second is
 * spoken (by then the learner knows what the screen wants).
 */
export function ruleDrills(rule: SyllabusRule): ItemExercise[] {
  const usable = rule.examples.filter((e) => !CONTRAST_FORM.test(e) && tokens(e).length >= 3);
  if (usable.length < 2) return [];

  const uniquesOf = new Map(usable.map((e) => [e, uniqueTokens(e, usable.filter((o) => o !== e))]));
  const drills: ItemExercise[] = [];

  for (const example of usable) {
    const mine = uniquesOf.get(example) ?? [];
    if (mine.length === 0) continue;
    const rivals = usable.filter((o) => o !== example).flatMap((o) => uniquesOf.get(o) ?? []);
    if (rivals.length === 0) continue;

    // One drill per example always; a SECOND only when the next-best word is a
    // genuine inflection contrast (a near-twin in the rival example), never merely
    // to reach a count. A padded drill is worse than a short lesson.
    const ranked = rankByRuleSalience(mine, rivals);
    const targets = [ranked[0]];
    const second = ranked[1];
    if (second && Math.max(0, ...rivals.map((r) => sharedPrefix(norm(second), norm(r)))) >= TWIN_PREFIX) {
      targets.push(second);
    }
    for (const target of targets) {
      drills.push(...buildDrill(example, target, rivals, drills.length, rule.description));
    }
  }
  return drills.slice(0, MAX_DRILLS);
}

/** How many leading letters two words must share to count as an inflection
 *  contrast (`piace`/`piacciono`, `fossi`/`fosse`) rather than two unrelated words. */
const TWIN_PREFIX = 3;

/** One drill for a chosen target word, or `[]` when no usable distractor exists.
 *  `index` decides the invite so a lesson always offers both ways to answer — the
 *  first drill is tapped (nothing to learn about the interface), the next is
 *  spoken (by then the learner knows what the screen is asking for). */
function buildDrill(
  example: string,
  target: string,
  rivals: readonly string[],
  index: number,
  rationale: string,
): ItemExercise[] {
  const ownTokens = tokens(example);
  const gapIndex = ownTokens.indexOf(target);
  if (gapIndex < 0) return [];
  const inSentence = new Set(ownTokens.map(norm));

  const chosen: string[] = [];
  for (const candidate of rankByRuleSalience(rivals, [target])) {
    const opt = asOption(candidate);
    if (!opt || norm(opt) === norm(target)) continue;
    if (inSentence.has(norm(opt))) continue;
    if (chosen.some((c) => norm(c) === norm(opt))) continue;
    if (!capitalizationFits(opt, asOption(target), gapIndex === 0)) continue;
    chosen.push(opt);
    if (chosen.length >= DRILL_OPTIONS - 1) break;
  }
  if (chosen.length === 0) return [];

  const answer = asOption(target);
  // Deterministic option order: the answer is placed by a stable hash of the cue
  // rather than at a fixed index, so the correct choice is not always in the same
  // position and the lesson still renders identically on every reload.
  const prompt = ownTokens.map((t, i) => (i === gapIndex ? CLOZE_BLANK : t)).join(" ");
  // THE CUE MUST NOT CONTAIN ITS OWN ANSWER. Checked on the FINISHED prompt rather
  // than on the token list, because there are several ways the word gets back in and
  // only the finished string sees all of them: a second standalone occurrence ("il
  // libro del ragazzo"), or one hiding inside another word — "Quanti anni ha? Avrà
  // cinquant'anni." blanks `anni` and leaves `cinquant'anni` on screen, which reads
  // as the answer to anyone who can see. Blanking every occurrence would need two
  // gaps, which is a different exercise; skipping is honest and there is always
  // another candidate word.
  if (wordsOf(prompt).includes(norm(target))) return [];

  const options = [...chosen];
  const slot = [...example, ...target].reduce((a, c) => a + c.charCodeAt(0), 0) % (options.length + 1);
  options.splice(slot, 0, answer);

  return [
    {
      type: "choice",
      prompt,
      options,
      answerIndex: options.indexOf(answer),
      answer,
      invite: index % 2 === 0 ? "click" : "speak",
      rationale,
    },
  ];
}

export function ruleIsTeachable(rule: SyllabusRule): boolean {
  return ruleDrills(rule).length >= MIN_DRILLS;
}

/**
 * The whole deterministic lesson for a syllabus rule, or null when the rule's
 * examples cannot produce enough drills (the picker then tries the next rule).
 *
 * The teaching text is the rule's own English description — it is what E-26 wrote
 * the syllabus for, and putting a model in front of it would be paying to
 * paraphrase content we already own. It goes through `trimToBudget` like every
 * other lesson, so the five-minute promise holds on this path too.
 */
export function buildRuleLesson(rule: SyllabusRule, register: string): ItemLesson | null {
  const exercises = ruleDrills(rule);
  if (exercises.length < MIN_DRILLS) return null;
  return trimToBudget({
    itemId: ruleKeyToItemId(rule.key),
    kind: "grammar" as const,
    register,
    intro: `${rule.title} (${rule.cefr}). ${rule.description}`,
    examples: rule.examples.slice(0, MAX_EXAMPLES),
    newWords: [],
    glossEn: null,
    exercises,
    deterministic: true,
  });
}

/** The deterministic lesson for a knowledge item id, or null when the id is not a
 *  syllabus rule (a lemma needs an English gloss, which no offline source has). */
export function deterministicLessonFor(itemId: string, register: string): ItemLesson | null {
  const { rules } = loadSyllabus();
  const rule = rules.find((r) => ruleKeyToItemId(r.key) === itemId);
  if (!rule) return null;

  const own = buildRuleLesson(rule, register);
  if (own) return own;

  // ── THE SUBSTITUTION, and why it is not a fudge ───────────────────────────
  //
  // 48 of the 266 shipped rules illustrate themselves with word lists rather than
  // sentences ("palla vs pala", "casa: c-a-s-a"), and no fair gap drill can be cut
  // from those. Driving the built server found the consequence: the composer
  // queued one of them at the learner's edge and the lesson route answered 404 —
  // a wall, which is exactly what D-26 forbids and what a unit test could not see
  // because it never asked the composer what it had chosen.
  //
  // A wall is the worst answer available. Teaching a NEIGHBOURING rule is a good
  // one: the composer's real instruction is "teach something at this learner's
  // edge", and the CEFR band is what carries that, not the individual key. So the
  // substitute is drawn from the same band first, then from anywhere — and the
  // lesson it returns carries the SUBSTITUTE's `itemId`, so the evidence the
  // learner earns is recorded against the rule they were actually taught rather
  // than against the one we could not teach.
  const sameBand = rules.filter((r) => r.cefr === rule.cefr && ruleIsTeachable(r));
  const substitute = sameBand[0] ?? pickTeachableRule();
  return substitute ? buildRuleLesson(substitute, register) : null;
}

/**
 * The first teachable rule from `preferred` (the composer's choices, in its own
 * order), falling back to the syllabus's own order.
 *
 * The fallback is what makes "a lesson always exists" true rather than hoped for:
 * `tests/syllabus-lesson.test.ts` counts how many of the 266 rules are teachable,
 * so the guarantee rests on a measured number and goes red if the syllabus ever
 * changes underneath it.
 */
export function pickTeachableRule(preferred: readonly string[] = []): SyllabusRule | null {
  const { rules } = loadSyllabus();
  const byKey = new Map(rules.map((r) => [r.key, r]));
  for (const key of preferred) {
    const rule = byKey.get(key) ?? byKey.get(key.replace(/^rule:/, ""));
    if (rule && ruleIsTeachable(rule)) return rule;
  }
  return rules.find(ruleIsTeachable) ?? null;
}
