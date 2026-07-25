import { getDb } from "@/lib/db";
import { getAttempt } from "@/lib/pronunciation";
import { audioFileResponse } from "@/lib/audio-response";

// Stream one drill take back to the learner (E-37). This is how "tap a word to hear
// how you said it" works: the client seeks into this file using the word's stored
// offset/duration ticks, so a single word slice is a seek, not a second file. The
// audio is the learner's own take under `data/pronunciation/`; a missing file answers
// 404 (orphan-safe, the phrase-render precedent).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ attemptId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { attemptId } = await params;
  const attempt = getAttempt(getDb(), attemptId);
  if (!attempt) return new Response("Not found", { status: 404 });
  return audioFileResponse(request, attempt.audioPath, "audio/wav");
}
