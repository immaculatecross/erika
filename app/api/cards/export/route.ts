import { getDb } from "@/lib/db";
import { listCards } from "@/lib/cards";
import { cardsToCsv, CSV_CONTENT_TYPE, CSV_FILENAME } from "@/lib/cards-csv";

// Export every card as an Anki-importable CSV (E-5b). Two positional columns —
// Front (the phrase in context) and Back (the recast + why) — RFC 4180 escaped by
// the pure lib/cards-csv serializer so commas, quotes, and newlines survive import.
// Downloaded as an attachment via Content-Disposition. GET only — no mutation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const csv = cardsToCsv(listCards(getDb()));
  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${CSV_FILENAME}"`,
    },
  });
}
