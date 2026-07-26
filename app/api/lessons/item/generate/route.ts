import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { itemExists } from "@/lib/knowledge/items";
import { itemLessonKind, todaysLesson } from "@/lib/lessons/item-lessons";
import { openAiTextModel } from "@/lib/lessons/text-model";

// TODAY'S LESSON for a composer-chosen knowledge item (E-45 criteria 1 & 2, D-27).
//
// The route answers with `todaysLesson`, which CANNOT FAIL: the cached lesson, else
// a freshly generated one, else the deterministic syllabus lesson — which needs no
// key, no budget and no network. So there is no 402 branch and no 502 branch here
// any more, and the runner has no "unavailable right now" screen to render.
//
// That is the point of the change rather than a side effect. The old route returned
// 402 when the monthly cap was reached and 502 when a reply was unreadable, and both
// were dead ends for a lesson the learner could always have had for free. A billed
// generation now either produces a usable lesson or is quietly not used.
//
// Generation is still billable and still capped — the cap lives inside
// `generateItemLesson` (reserve-before-call), and a cache hit bills nothing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId || itemLessonKind(itemId) === null) {
    return NextResponse.json({ error: "A grammar or vocabulary item id is required." }, { status: 400 });
  }
  if (!itemExists(db, itemId)) {
    return NextResponse.json({ error: "No such knowledge item." }, { status: 404 });
  }

  const lesson = await todaysLesson(db, openAiTextModel, itemId);
  if (!lesson) {
    // The only remaining refusal: a vocabulary item with no key and no cached
    // lesson. There is no offline Italian-English gloss source, so a vocabulary
    // lesson genuinely needs a model — this is a truthful "not this one", and the
    // composer has grammar items that always work.
    return NextResponse.json(
      { error: "This word's lesson needs an API key. Today's grammar lesson is ready without one." },
      { status: 404 },
    );
  }
  return NextResponse.json({ lesson, cached: !lesson.deterministic });
}
