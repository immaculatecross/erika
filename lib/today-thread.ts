import type { Db } from "./db";
import { localDay, localDayBoundsUtc, localHour } from "./local-day";
import { parseItemId, getItem } from "./knowledge/items";
import { learnerSpokeAnyOf } from "./speaker/own-speech";
import { CAPTURED_AT_SQL } from "./capture-time";

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
// WHEN THEY SPOKE ≠ WHEN WE NOTICED (review F1). Both load-bearing facts in the
// sentence — which local day it belongs to, and "this morning/afternoon/evening" —
// are read from the SESSION'S CAPTURE TIME plus the segment's offset into the
// recording: exactly the instant `lib/slip-hours.ts` bins on, so a 24-hour dump bins
// correctly WITHIN itself. They are emphatically NOT read from `evidence.created_at`,
// which is `datetime('now')` at MINT time — the moment the deep pass ran. Under
// Erika's day-scale async capture with a user-triggered Analyze, capture ≠ analysis
// is the NORMAL case: a learner who dumps a day of audio and hits Analyze after
// dinner would otherwise be told "this evening's recording" whenever they actually
// spoke, and would get no beat at all on the day they really said it. A session whose
// capture time is missing or unreadable is SKIPPED, not cited — the same
// "unverifiable ⇒ not a claim we make" stance as the rest of this module.
//
// [E-39 §B2] …and until now that CAPTURE TIME was `sessions.created_at`, which is the
// UPLOAD instant. The reasoning above was right and the column was wrong, so the exact
// case it was written to defeat — record at 08:10, upload at 21:30 — still produced
// "this evening's recording", and an evening upload of the morning's speech landed on
// the wrong local day. It now reads `sessions.captured_at` (lib/capture-time.ts), which
// is NULL when nothing told us — and this module's existing stance already does the
// right thing with a NULL: no capture time, no beat. It says less on a picked file with
// no metadata, and what it says is true.
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
  /** The SESSION's capture time — when the learner actually spoke (E-39 §B2:
   *  `sessions.captured_at`, never the upload instant). NULL when the session is gone
   *  OR when nothing recorded a capture time; either way the row is skipped, not cited. */
  session_captured_at: string | null;
}

/**
 * How far back the capture-time prefilter reaches before the target local day. A
 * segment's offset can carry a spoken instant hours or a day past its session's
 * capture time (a 24 h dump), so a session captured BEFORE the day can still hold
 * speech that falls inside it. This margin is only a performance bound — the exact
 * answer is the per-row reduction below — so it is set far beyond any plausible
 * single recording rather than tuned.
 */
const CAPTURE_PREFILTER_DAYS = 31;

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
 * Spontaneous production positives the learner themself SPOKE on local day `day`.
 * There is no "evidence on local day D" query anywhere else in the app — this is it.
 *
 * The instant a row is judged on is the SESSION'S CAPTURE TIME plus the segment's
 * offset into the recording, summed in epoch ms and only then reduced to a local day
 * / local hour — the same order `lib/slip-hours.ts` uses, so an offset that crosses
 * an hour or a midnight lands in the right place. `evidence.created_at` (the mint
 * instant) is deliberately unused for anything the learner is told (review F1).
 *
 * SQL prefilters on capture time only as a bound (a spoken instant is never EARLIER
 * than its capture, so `< dayEnd` is exact; the lower side uses
 * `CAPTURE_PREFILTER_DAYS`); the exact answer is the per-row reduction below, so a
 * DST-shortened or -lengthened day still selects exactly the rows inside it.
 */
function producedOnLocalDay(db: Db, day: string): { itemId: string; spokenMs: number }[] {
  const { startMs, endMs } = localDayBoundsUtc(day);
  const rows = db
    .prepare(
      `SELECT e.item_id AS item_id, e.source_ref AS source_ref, e.session_id AS session_id,
              ${CAPTURED_AT_SQL} AS session_captured_at
         FROM evidence e
         LEFT JOIN sessions s ON s.id = e.session_id
        WHERE e.source = 'finding' AND e.mode = 'spontaneous' AND e.polarity = 1
          AND e.source_ref IS NOT NULL
          AND COALESCE(s.exclude_from_evidence, 0) = 0
          AND ${CAPTURED_AT_SQL} IS NOT NULL
          AND ${CAPTURED_AT_SQL} >= ? AND ${CAPTURED_AT_SQL} < ?`,
    )
    .all(sqliteUtc(startMs - CAPTURE_PREFILTER_DAYS * 86_400_000), sqliteUtc(endMs)) as ProducedRow[];

  // Every segment carrying this audio in this session. A hash can repeat within a
  // session, so the verdict is taken over ALL of them and fails safe: if any copy was
  // attributed to somebody else, we cannot say the learner spoke it.
  const segmentsFor = db.prepare(
    "SELECT start_ms, is_user FROM segments WHERE session_id = ? AND content_hash = ? ORDER BY start_ms",
  );

  const out: { itemId: string; spokenMs: number }[] = [];
  for (const r of rows) {
    if (!r.session_captured_at || !r.session_id) continue; // no capture time ⇒ never cited
    const captureMs = utcMs(r.session_captured_at);
    if (Number.isNaN(captureMs)) continue; // unreadable capture time ⇒ never cited
    const hash = contentHashOfSourceRef(r.source_ref);
    if (!hash) continue; // unverifiable provenance ⇒ never cited
    const segs = segmentsFor.all(r.session_id, hash) as { start_ms: number; is_user: 0 | 1 | null }[];
    if (segs.length === 0) continue; // the segment is gone — we cannot say whose voice it was
    // The ONE speaker rule (lib/speaker/own-speech.ts); `exclude_from_evidence` is
    // already filtered in the SQL above, so the session half is satisfied here.
    if (!learnerSpokeAnyOf(segs, { excludeFromEvidence: false })) continue;

    // The moment they spoke: capture time + the segment's offset into the recording.
    // A content hash can REPEAT within one session (the same audio twice), and the
    // evidence row is keyed by the hash, not by one occurrence — so we do not know
    // WHICH one it came from. Rather than silently claiming the earliest (review nit
    // 4), we cite only when the occurrences AGREE on what we are about to say: same
    // local day, same part of day. If they disagree, the sentence would have to pick,
    // and picking is the one thing this module never does.
    const instants = segs.map((s) => captureMs + Math.max(0, s.start_ms));
    const claims = new Set(instants.map((ms) => `${localDay(new Date(ms))}|${partOfDay(localHour(new Date(ms)))}`));
    if (claims.size > 1) continue; // ambiguous ⇒ not a claim we make

    const spokenMs = instants[0];
    if (localDay(new Date(spokenMs)) !== day) continue; // exact local-day reduction
    out.push({ itemId: r.item_id, spokenMs });
  }
  // Most recently spoken first, deterministic on ties.
  out.sort((a, b) => b.spokenMs - a.spokenMs || (a.itemId < b.itemId ? -1 : 1));
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
 * The beat for `day`: the most recently SPOKEN knowledge item that is BOTH on today's
 * plan and carries a qualifying production from that day. Null when nothing qualifies
 * — which is the common case and the correct output, not a gap to fill.
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
      partOfDay: partOfDay(localHour(new Date(produced.spokenMs))),
    };
  }
  return null;
}
