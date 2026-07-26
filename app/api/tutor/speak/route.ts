import { handleSpeak } from "@/lib/tutor/speak-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleSpeak(request);
}
