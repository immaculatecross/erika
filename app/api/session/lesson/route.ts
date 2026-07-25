import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api/error";
import { localDay } from "@/lib/local-day";
import { generateItemLesson, getItemLesson } from "@/lib/lessons/item-lessons";
import { openAiTextModel, TextModelParseError, TextModelUnavailableError } from "@/lib/lessons/text-model";
import { BudgetExceededError } from "@/lib/lessons/billing";
import { buildSessionView, syllabusFallback } from "@/lib/session/view";
import { textModelReachable } from "@/lib/session/plan";
import type { NoticeReason } from "@/lib/session/notices";
import type { ItemLesson } from "@/lib/lessons/item-lessons-view";

// Today's lesson (E-44). ONE route serving BOTH halves of the session's teaching: the
// explanation the lesson step reads, and the exercises the drills step runs.
//
// ── THIS IS WHERE CRITERION 3 IS WON OR LOST ─────────────────────────────────────
// Every path out of here either returns a lesson the learner can do, or returns the
// syllabus's own authored content for the same rule plus a notice that names the real
// condition and its remedy. There is no branch that returns nothing.
//
// A rule ALWAYS has content: E-26 authored a title, a description and correct examples
// for all 266 of them, committed in the repo, needing no key, no budget and no
// network. So the degraded lesson is not a placeholder — it is the lesson, minus the
// exercises. That is what "degrades to something real" means here.
//
// POST, not GET: it can make a billable model call, and a call that spends money must
// never ride a GET (the E-18/E-24 read/write split, extended to spend). A cached
// lesson still bills ZERO — `generateItemLesson` returns it before reserving.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SessionLessonBody {
  itemId: string;
  kind: "grammar" | "vocab";
  label: string | null;
  /** The generated lesson (intro + exercises), or null when it could not be written. */
  lesson: ItemLesson | null;
  /** The syllabus's own authored content — always present for a rule. */
  fallback: ReturnType<typeof syllabusFallback>;
  /** Why `lesson` is null. Null when the lesson is there. */
  notice: NoticeReason | null;
}

/**
 * Classify a failed model call. A 401/403 means a key IS configured and was refused —
 * a standing condition with a different remedy from "no key at all", and telling a
 * learner who has set a key that none is set would send them to check something
 * already correct.
 */
function noticeForModelError(err: unknown): NoticeReason {
  if (err instanceof BudgetExceededError) return "budget";
  if (err instanceof TextModelUnavailableError) {
    return /\b(401|403)\b/.test(err.message) ? "key-rejected" : "model-transient";
  }
  if (err instanceof TextModelParseError) return "model-transient";
  throw err;
}

export async function POST() {
  const db = getDb();
  const day = localDay();
  const view = buildSessionView(db, day);
  if (!view.lesson) {
    return apiError("no_lesson", "Today's session has no lesson step.", 404);
  }

  const { itemId, kind, label } = view.lesson;
  const fallback = syllabusFallback(itemId);
  const base = { itemId, kind, label, fallback };

  const cached = getItemLesson(db, itemId);
  if (cached) return NextResponse.json({ ...base, lesson: cached, notice: null });

  // Two standing conditions answerable without a call. Checking them here means a
  // keyless learner is never made to wait on a network round-trip to be told
  // something the server already knew.
  const reach = textModelReachable(db);
  if (!reach.ok) return NextResponse.json({ ...base, lesson: null, notice: reach.reason });

  try {
    const { lesson } = await generateItemLesson(db, openAiTextModel, itemId);
    // A racing loser returns null while the winner is still writing. That used to be a
    // 202 the client read as success before crashing on the missing body; it is now a
    // named, retryable state with the rule's own content underneath it.
    const finished = lesson ?? getItemLesson(db, itemId);
    if (!finished) return NextResponse.json({ ...base, lesson: null, notice: "in-flight" });
    return NextResponse.json({ ...base, lesson: finished, notice: null });
  } catch (err) {
    return NextResponse.json({ ...base, lesson: null, notice: noticeForModelError(err) });
  }
}
