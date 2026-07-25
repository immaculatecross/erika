import { formatUsd } from "../format";
import type { LandTakeOutcome } from "./take";

// What the learner is told when a conversation ends (E-43, D-24).
//
// ONE factual line, and its content follows what actually happened rather than being
// cheerful by default. D-24's ban list is the binding part: no celebration, no
// countdown, and **no guilt copy when the minimum was not reached** — falling short is
// simply not mentioned, because a conversation below the bar is still real and still
// taught Erika something.
//
// The one thing that IS always said is a take that failed to land, because the learner
// would otherwise believe a recording exists that does not (losing audio silently is
// the worst failure this app can have).

export function closingLine(metMinimum: boolean, take: LandTakeOutcome): string {
  if (take.kind === "lost" || take.kind === "refused") return take.message;
  const listening = take.kind === "uploaded" ? " Erika is listening back to it now." : "";
  return metMinimum ? `That conversation counts toward today.${listening}`.trim() : listening.trim() || "Conversation ended.";
}

/**
 * What that conversation cost — the second line the tutor shows when a call ends
 * (operator ruling: *"just show how much that has cost"*).
 *
 * ⚠️ THIS IS THE COMMITTED ACTUAL, NEVER THE RESERVATION AND NEVER A PROJECTION. The
 * distinction is the whole point. `/end` collapses the lease into exactly one committed
 * ledger row and returns that number; the reservation it replaces is routinely ~2× it,
 * because the rate table is a deliberate floor (lib/analysis/rates-realtime.ts). Showing
 * the reserved figure would over-state every conversation the app ever holds and would
 * be the app lying about its own cost in the one place it now promises not to.
 *
 * It does NOT reintroduce the pre-run estimates D-26 removed from the flow: nothing is
 * shown before or during a conversation, only after one, and only as fact. Sub-dime
 * amounts keep three decimals (`formatUsd`) so a cheap conversation reads as
 * "$0.043" rather than a falsely-free "$0.00".
 *
 * Null when nothing was committed — a session that never opened, or one whose lease was
 * already finalized by a racing beacon. Saying "$0.00" there would be a claim, not a
 * fact.
 */
export function costLine(committedUsd: number | null | undefined): string | null {
  if (typeof committedUsd !== "number" || !Number.isFinite(committedUsd) || committedUsd <= 0) return null;
  return `That conversation cost ${formatUsd(committedUsd)}.`;
}
