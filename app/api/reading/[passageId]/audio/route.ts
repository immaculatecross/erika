import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { getPassage } from "@/lib/canon";
import { getPhraseRender, phraseHash } from "@/lib/render/phrase-renders";
import { audioFileResponse } from "@/lib/audio-response";

// Stream a canon passage's rendered listen clip (E-33). Keyed by the phrase hash of
// the passage text + current register; a render that has not been generated (or
// whose file is gone) answers 404 — orphan-safe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ passageId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { passageId } = await params;
  const db = getDb();
  const passage = getPassage(passageId);
  if (!passage) return new Response("Not found", { status: 404 });

  const register = coerceRegister(readSettings(db).register);
  const render = getPhraseRender(db, phraseHash(passage.text, register));
  if (!render) return new Response("Not found", { status: 404 });
  return audioFileResponse(request, render.path);
}
