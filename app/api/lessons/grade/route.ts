import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { gradeRewrite } from "@/lib/lessons/grade";
import { openAiTextModel } from "@/lib/lessons/text-model";
import { BudgetExceededError } from "@/lib/lessons/billing";
import { lessonModelErrorResponse } from "../errors";

// Grade a learner's free-text rewrite against the exercise target (E-6, D-10). A
// billable text-model call, so the budget cap is enforced inside `gradeRewrite`
// (before the call) and its spend records into the shared ledger. POST only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as {
    patternKey?: unknown;
    target?: unknown;
    rewrite?: unknown;
  };
  const patternKey = typeof body.patternKey === "string" ? body.patternKey : "";
  const target = typeof body.target === "string" ? body.target : "";
  const rewrite = typeof body.rewrite === "string" ? body.rewrite : "";
  if (!patternKey || !target || !rewrite.trim()) {
    return NextResponse.json({ error: "patternKey, target and a non-empty rewrite are required." }, { status: 400 });
  }

  try {
    const result = await gradeRewrite(db, openAiTextModel, { patternKey, target, rewrite });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    return lessonModelErrorResponse(err);
  }
}
