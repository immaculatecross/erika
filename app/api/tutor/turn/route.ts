import { handleTranscriptTurn } from "@/lib/tutor/transcript-turn-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleTranscriptTurn(request);
}
