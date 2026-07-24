import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { shadowTarget } from "@/lib/shadow";
import { getPhraseRender, phraseHash } from "@/lib/render/phrase-renders";
import { audioFileResponse } from "@/lib/audio-response";

// Stream a shadow drill's rendered target clip (E-33). The clip is keyed by the
// phrase hash of the finding's correct correction + the current register; a render
// that has not been generated (or whose file is gone) answers 404 — orphan-safe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const drill = shadowTarget(db, findingId);
  if (!drill) return new Response("Not found", { status: 404 });

  const register = coerceRegister(readSettings(db).register);
  const render = getPhraseRender(db, phraseHash(drill.target, register));
  if (!render) return new Response("Not found", { status: 404 });
  return audioFileResponse(request, render.path);
}
