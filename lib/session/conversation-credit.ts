import type { Db } from "../db";
import { localDay } from "../local-day";

// The ONE question E-44 asks the tutor: did a conversation meet its minimum duration
// on this local day (D-26 — "only when this duration is hit, then this will validate
// the streak")? Nothing else about the tutor is E-44's business, and this module is
// the whole of the coupling: one table, one column, one boolean.
//
// The contract is E-43's `tutor_conversations` (migration v29), read here rather than
// through `lib/tutor/conversations.ts` for one reason only — E-43 is not merged, so
// that module does not exist on this branch. When it lands, this file's body becomes
// a call to its `metMinimumOnDay` and the SQL below is deleted; the SHAPE the rest of
// E-44 depends on (`conversationCredit`) does not change, which is the point of
// keeping it behind a function.
//
// ⚠️ IT DEGRADES BY ABSENCE, AND THAT IS DELIBERATE. On a database where v29 has not
// been applied there is no record of any conversation, so this build genuinely cannot
// know whether one happened, let alone whether it was long enough. The honest answer
// to that is not "no" and it is certainly not "yes" — it is "this build cannot record
// a conversation", which is why `available` is a separate field from `met`. The
// planner reads `available` and simply does not put a conversation step in the day:
// a step whose completion could never be observed would be a control that does
// nothing, which criterion 3 calls worse than no control at all.

/** Whether a conversation can be credited at all here, and whether one was today. */
export interface ConversationCredit {
  /** This build can record conversations (E-43's v29 is applied). */
  available: boolean;
  /** A conversation met its minimum on the day asked about. False when unavailable. */
  met: boolean;
}

/** Is E-43's durable conversation record present in this database? */
export function conversationRecordAvailable(db: Db): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'tutor_conversations'")
    .get() as { present: number } | undefined;
  return row !== undefined;
}

/**
 * Did a CLOSED conversation meet its minimum on `day`? Mirrors E-43's
 * `metMinimumOnDay` exactly — `met_minimum` is decided once at close and stored, so
 * changing the minimum tomorrow can never rewrite a day already credited (the E-38
 * rule: recorded history is never rewritten).
 */
export function conversationCredit(db: Db, day: string = localDay()): ConversationCredit {
  if (!conversationRecordAvailable(db)) return { available: false, met: false };
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM tutor_conversations " +
        "WHERE local_day = ? AND ended_at IS NOT NULL AND met_minimum = 1",
    )
    .get(day) as { n: number };
  return { available: true, met: row.n > 0 };
}
