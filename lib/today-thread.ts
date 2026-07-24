import type { Db } from "./db";
import { localDay, localDayBoundsUtc, localHour } from "./local-day";
import { parseItemId, getItem } from "./knowledge/items";

// "Today's thread" (E-38, RETRO-003 owed item, D-19). ONE factual beat connecting
// today's plan to something the learner ACTUALLY SAID:
//
//   "Today's plan included magari — and you used it in this morning's recording."
//
// THIS SENTENCE MUST BE TRUE, WHICH IS THE WHOLE FEATURE. Everything below exists to
// make the claim unfalsifiable rather than plausible:
//
//  · "you used it" means SPONTANEOUS PRODUCTION, in the learner's OWN SPEECH. Only
//    `source = 'finding'` + `mode = 'spontaneous'` + `polarity = 1` evidence
//    qualifies — the produced-lemma positives the deep pass mints from a recording
//    (E-28). A CUED exercise answer or a RECOGNITION placement seed is not "you used
//    it" and is excluded by the mode filter; so is any negative.
//  · E-36'S SPEAKER GATE IS RE-APPLIED AT READ TIME, not merely trusted at write
//    time. The row's idempotency `source_ref` (`<session>:<segment content_hash>:
//    <lemma>#<POS>`, lib/analysis/produced-lemmas.ts) resolves back to the exact
//    SEGMENT, and a segment with `is_user = 0` — attributed to somebody else — can
//    never be cited. `is_user IS NULL` is UNATTRIBUTED and counts as the user,
//    matching E-36's recall-first stance everywhere else (D-22).
//  · A SESSION MARKED "not me" (`sessions.exclude_from_evidence`) is excluded, and
//    it is excluded here rather than only at write time because the toggle can be
//    flipped AFTER the evidence was minted. Re-reading the flag is what makes the
//    exclusion retroactive on this surface.
//  · A row whose segment can no longer be resolved (a legacy pre-E-36 positive with
//    a NULL `source_ref`, or a deleted session) is NOT cited. We would be unable to
//    say whose voice it was, and an unverifiable claim is not a claim we make.
//  · IF NOTHING QUALIFIES THERE IS NO BEAT. The builder returns null and the surface
//    renders nothing — no manufactured connection, no generic encouragement, no
//    "keep going". Silence is the honest output (D-24 bans the nag anyway).
//
// This module WRITES NOTHING: `evidence` is append-only and read-only to E-38.

/** The one beat, or null when nothing true can be said. */
export interface TodayThread {
  /** The knowledge item today's plan named AND the learner produced today. */
  itemId: string;
  /** How the item is named to the learner (the lemma, normally). */
  label: string;
  /** When they produced it, in the learner's own local clock. */
  partOfDay: "this morning" | "this afternoon" | "this evening";
}

interface ProducedRow {
  item_id: string;
  source_ref: string;
  session_id: string | null;
  created_at: string;
}

/** SQLite UTC text ("YYYY-MM-DD HH:MM:SS") → epoch ms, or NaN — the day-ledger
 *  reduction pattern (lib/day-ledger.ts), reused so there is one parse in the app. */
function utcMs(sqliteTs: string): number {
  return Date.parse(sqliteTs.replace(" ", "T") + "Z");
}

/** SQLite UTC text for an epoch instant, for range-comparing the text column. */
function sqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function partOfDay(hour: number): TodayThread["partOfDay"] {
  if (hour < 12) return "this morning";
  if (hour < 18) return "this afternoon";
  return "this evening";
}

/** The segment content hash inside a produced-lemma `source_ref`
 *  (`<session>:<contentHash>:<lemma>#<POS>`), or null if it is not that shape. */
export function contentHashOfSourceRef(sourceRef: string): string | null {
  const parts = sourceRef.split(":");
  return parts.length >= 3 && parts[1] ? parts[1] : null;
}

/**
 * Spontaneous production positives the learner themself produced on local day `day`.
 * There is no "evidence on local day D" query anywhere else in the app — this is it.
 * The UTC `created_at` text is prefiltered to the local day's real UTC interval and
 * then reduced per row (the day-ledger pattern), so a DST-shortened or -lengthened
 * day still selects exactly the rows that fell inside it.
 */
function producedOnLocalDay(db: Db, day: string): { itemId: string; hour: number; at: string }[] {
  const { startMs, endMs } = localDayBoundsUtc(day);
  const rows = db
    .prepare(
      `SELECT e.item_id AS item_id, e.source_ref AS source_ref, e.session_id AS session_id,
              e.created_at AS created_at
         FROM evidence e
         LEFT JOIN sessions s ON s.id = e.session_id
        WHERE e.source = 'finding' AND e.mode = 'spontaneous' AND e.polarity = 1
          AND e.source_ref IS NOT NULL
          AND COALESCE(s.exclude_from_evidence, 0) = 0
          AND e.created_at >= ? AND e.created_at < ?
        ORDER BY e.created_at DESC, e.id`,
    )
    .all(sqliteUtc(startMs), sqliteUtc(endMs)) as ProducedRow[];

  const segmentVerdict = db.prepare(
    "SELECT is_user FROM segments WHERE session_id = ? AND content_hash = ? LIMIT 1",
  );

  const out: { itemId: string; hour: number; at: string }[] = [];
  for (const r of rows) {
    const ms = utcMs(r.created_at);
    if (Number.isNaN(ms) || localDay(new Date(ms)) !== day) continue; // exact local-day reduction
    const hash = contentHashOfSourceRef(r.source_ref);
    if (!hash || !r.session_id) continue; // unverifiable provenance ⇒ never cited
    const seg = segmentVerdict.get(r.session_id, hash) as { is_user: number | null } | undefined;
    if (!seg) continue; // the segment is gone — we cannot say whose voice it was
    if (seg.is_user === 0) continue; // attributed to somebody else (E-36, D-22)
    out.push({ itemId: r.item_id, hour: localHour(new Date(ms)), at: r.created_at });
  }
  return out;
}

/** How the item is named to the learner. */
function labelFor(db: Db, itemId: string): string {
  const parsed = parseItemId(itemId);
  if (parsed.lemma) return parsed.lemma;
  const item = getItem(db, itemId);
  if (item?.lemma) return item.lemma;
  if (itemId.startsWith("rule:")) return itemId.slice("rule:".length).replace(/-/g, " ");
  return itemId;
}

/**
 * The beat for `day`: the most recent knowledge item that is BOTH on today's plan
 * and carries a qualifying production from today. Null when nothing qualifies —
 * which is the common case and the correct output, not a gap to fill.
 */
export function buildTodayThread(
  db: Db,
  day: string,
  targetItemIds: readonly string[],
): TodayThread | null {
  if (targetItemIds.length === 0) return null;
  const targets = new Set(targetItemIds);
  for (const produced of producedOnLocalDay(db, day)) {
    if (!targets.has(produced.itemId)) continue;
    return {
      itemId: produced.itemId,
      label: labelFor(db, produced.itemId),
      partOfDay: partOfDay(produced.hour),
    };
  }
  return null;
}
