import type { Db } from "../db";
import { localDay } from "../local-day";
import { metMinimumOnDay } from "../tutor/conversations";

// The ONE question E-44 asks the tutor: did a conversation meet its minimum duration
// on this local day (D-26 — "only when this duration is hit, then this will validate
// the streak")? Nothing else about the tutor is E-44's business, and this module is
// the whole of the coupling: one table, one column, one boolean.
//
// The contract is E-43's `tutor_conversations` (migration v29), and the "did one count
// today" question is answered by E-43's OWN reader, `lib/tutor/conversations.ts`
// `metMinimumOnDay` — one reader, one answer, the `lib/findings-model.ts` rule (E-17).
// (Until E-43 merged, this file carried a copy of that SQL; the copy is gone.) What
// stays here is the part E-43 does not own: whether this build can observe a
// conversation AT ALL.
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
 * Did a CLOSED conversation meet its minimum on `day`? Delegated to E-43's
 * `metMinimumOnDay` — `met_minimum` is decided once at close and stored there, so
 * changing the minimum tomorrow can never rewrite a day already credited (the E-38
 * rule: recorded history is never rewritten).
 */
export function conversationCredit(db: Db, day: string = localDay()): ConversationCredit {
  if (!conversationRecordAvailable(db)) return { available: false, met: false };
  return { available: true, met: metMinimumOnDay(db, day) };
}
