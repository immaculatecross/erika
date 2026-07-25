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
