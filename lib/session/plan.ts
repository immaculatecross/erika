import type { Db } from "../db";
import { compose, capsFromSettings } from "../compose";
import { countDueCards, generateCards } from "../cards";
import { localDay } from "../local-day";
import { budgetReached } from "../lessons/billing";
import { getItemLesson, itemLessonKind } from "../lessons/item-lessons";
import { parseItemId } from "../knowledge/items";
import { loadSyllabus } from "../syllabus";
import { collectLetterSessions, latestWeekWithFindings } from "../letter";
import { getViewedLetterWeek } from "../plan";
import { conversationCredit } from "./conversation-credit";
import { orderSteps, type StepKey } from "./steps";
import type { NoticeReason } from "./notices";

// The session PLANNER (E-44, D-27). Decides what today's session is — and, just as
// importantly, what it is NOT, with a reason.
//
// D-27 INVERTS the old ordering and this module is where that lands: the backbone is
// E-26's 266-rule syllabus and 30,786-lemma lexicon at the learner's own knowledge
// edge, and the learner's recordings are an OVERLAY woven in when they exist. So a
// learner who has never recorded anything gets the same shaped day as one who records
// daily — the lesson is drawn from the syllabus either way, and their findings only
// change WHICH cards ride along in the drills step. FSRS-due reviews stay first inside
// that step (spaced repetition is not negotiable) — `compose` still orders them ahead
// of everything, and `countDueCards` counts them ahead of the fresh ones.
//
// THE ONE RULE THAT MAKES CRITERION 3 STRUCTURAL: a step Erika cannot deliver is not
// in the session. It is not rendered as a row that refuses, because a row that refuses
// is a wall with a coat of paint. Every step in `steps` can run; everything else is in
// `omitted` with the reason, and the runner states that reason where it can be acted
// on. This is why the planner — not the UI — is the thing that has to be right.

/** A step left out of today's session, and why. */
export interface OmittedStep {
  key: StepKey;
  reason: NoticeReason;
}

export interface SessionPlan {
  day: string;
  /** The ordered steps today's session holds. */
  steps: StepKey[];
  /** The knowledge item the lesson step teaches, or null when there is no lesson. */
  lessonItemId: string | null;
  /** A short human label for it ("the alphabet and spelling", "sperare"). */
  lessonLabel: string | null;
  /** Cards the drills step sets out to do. Also the step's completion bar. */
  plannedCards: number;
  /** The ISO week of the letter this session would show, or null. */
  letterWeek: string | null;
  omitted: OmittedStep[];
}

/** Is a billable text call possible at all right now? Two standing conditions, both
 *  answerable server-side without making a call: a key, and headroom under the cap. */
export function textModelReachable(db: Db): { ok: boolean; reason: NoticeReason | null } {
  if (!process.env.OPENAI_API_KEY) return { ok: false, reason: "no-key" };
  if (budgetReached(db)) return { ok: false, reason: "budget" };
  return { ok: true, reason: null };
}

/**
 * The label a lesson wears in the day's sentence. A rule uses its syllabus title with
 * the first letter lowered, because the sentence reads "a lesson on …" and "a lesson
 * on The alphabet and spelling" is not English. An all-caps opener (an acronym) is
 * left alone. A lemma is simply itself.
 */
export function lessonLabelFor(itemId: string): string | null {
  const kind = itemLessonKind(itemId);
  if (kind === "grammar") {
    const key = itemId.slice("rule:".length);
    const rule = loadSyllabus().rules.find((r) => r.key === key);
    if (!rule) return null;
    const t = rule.title;
    if (t.length >= 2 && t.slice(0, 2) === t.slice(0, 2).toUpperCase()) return t;
    return t.charAt(0).toLowerCase() + t.slice(1);
  }
  if (kind === "vocab") return parseItemId(itemId).lemma ?? null;
  return null;
}

/**
 * Choose the ONE item today's lesson teaches.
 *
 * A GRAMMAR RULE IS PREFERRED, and that is a product call worth naming: a rule is the
 * only item kind that carries real teachable content with no model call at all —
 * E-26 authored a title, a two-to-four sentence description and correct examples for
 * all 266 of them. So a rule lesson can always be delivered, keyless, at the cap, with
 * the model down; a lemma cannot (the lexicon is frequency data — it has no glosses,
 * by licence: D-19 keeps the CC BY-NC sources out of the shipped data path). Choosing
 * the rule first is therefore what makes the lesson step incapable of ending at a
 * wall. A lemma is taken only when no rule is on today's plan AND a lesson for it can
 * actually be produced (one is already cached, or a call is possible).
 */
function chooseLessonItem(
  db: Db,
  itemIds: { kind: string; itemId: string | null }[],
  reachable: boolean,
): string | null {
  const rule = itemIds.find((i) => i.kind === "rule" && i.itemId)?.itemId ?? null;
  if (rule) return rule;
  const vocab = itemIds.find((i) => i.kind === "vocab" && i.itemId)?.itemId ?? null;
  if (!vocab) return null;
  if (getItemLesson(db, vocab) !== null) return vocab;
  return reachable ? vocab : null;
}

/** This week's letter, and whether it is still unread (the E-24 contract, untouched). */
function letterState(db: Db): { week: string | null; unread: boolean } {
  const week = latestWeekWithFindings(collectLetterSessions(db));
  const viewed = getViewedLetterWeek(db);
  return { week, unread: week !== null && (viewed === null || viewed < week) };
}

/**
 * Plan today's session.
 *
 * Two idempotent, model-free writes ride along, both on the read-path materialization
 * precedent this codebase already uses for slips and the spill queue: `compose`
 * reconciles the spill queue, and `generateCards` mints the cards for findings that
 * do not have one yet. The second is what makes the composer's `finding` plan items
 * REACH THE LEARNER (criterion 9) — an unspent finding is a fresh card, and a fresh
 * card is in the drills step. Neither write touches money, evidence or findings.
 */
export function planSession(db: Db, day: string = localDay()): SessionPlan {
  const composed = compose(db, day, capsFromSettings(db));
  generateCards(db);

  const reach = textModelReachable(db);
  const omitted: OmittedStep[] = [];
  const steps: StepKey[] = [];

  // ── the lesson ────────────────────────────────────────────────────────────
  const lessonItemId = chooseLessonItem(db, composed.items, reach.ok);
  const lessonLabel = lessonItemId ? lessonLabelFor(lessonItemId) : null;
  if (lessonItemId) steps.push("lesson");
  else omitted.push({ key: "lesson", reason: "nothing-to-teach" });

  // ── the drills ────────────────────────────────────────────────────────────
  // Exercises for the day's item plus every card due. A drills step with neither is
  // not offered at all — an empty step the learner has to tap through is exactly the
  // errand this milestone deletes.
  const plannedCards = countDueCards(db);
  const canHaveExercises =
    lessonItemId !== null && (getItemLesson(db, lessonItemId) !== null || reach.ok);
  if (plannedCards > 0 || canHaveExercises) steps.push("drills");
  else omitted.push({ key: "drills", reason: reach.reason ?? "no-cards" });

  // ── the letter (once a week) ──────────────────────────────────────────────
  const letter = letterState(db);
  if (letter.unread) steps.push("letter");

  // ── the conversation ──────────────────────────────────────────────────────
  // Already credited today ⇒ always in the session (it is a finished step, and
  // dropping it would silently un-do work the learner has done). Otherwise it needs a
  // build that can record it and a call that can actually be made.
  const credit = conversationCredit(db, day);
  if (credit.met) steps.push("conversation");
  else if (!credit.available) omitted.push({ key: "conversation", reason: "not-recorded" });
  else if (!reach.ok) omitted.push({ key: "conversation", reason: reach.reason ?? "no-key" });
  else steps.push("conversation");

  return {
    day,
    steps: orderSteps(steps),
    lessonItemId,
    lessonLabel,
    plannedCards,
    letterWeek: letter.week,
    omitted,
  };
}
