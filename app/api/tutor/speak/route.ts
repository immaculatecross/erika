import { handleSpeak } from "@/lib/tutor/speak";

// The tutor's SPEAKING leg (E-43, D-28) — the thin Next.js binding. All of the
// behaviour, and the injected vendor seam, live in lib/tutor/speak.ts: a route module
// may export only its HTTP verbs, so the testable handler cannot live here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleSpeak(request);
}
