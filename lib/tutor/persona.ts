import { registerInstruction, coerceRegister, type Register } from "../register";

// ─────────────────────────────────────────────────────────────────────────────
// The tutor persona (E-34). A pure, client-safe instruction builder — no model
// call, no DB — that assembles the Realtime tutor's system instruction from what
// the app already knows about the learner: the E-19 speaker profile, the active
// slips to steer toward, today's composer targets, and the E-33 register dial
// (D-23). `lib/tutor/session-config.ts` is the thin DB glue that collects these
// through the canonical readers and calls this.
//
// This grew from the E-33 hook (which pinned only the register). WO criterion 2:
// the instruction payload must contain the profile L1, the slip targets, today's
// items, and the register line — a fixture asserts each. The persona also states
// the `log_evidence` tool contract so the model knows to record what the learner
// gets right and wrong during the call (WO criterion 3); the tool SCHEMA lives in
// the session config, this only tells the model when to use it.
// ─────────────────────────────────────────────────────────────────────────────

/** What the tutor persona is built from (E-34). Every learner-specific field is
 *  optional so a fresh user still yields a well-formed persona. */
export interface TutorPersonaInput {
  /** The learner's register dial (E-33, D-23). */
  register: Register;
  targetLanguage: string;
  nativeLanguage: string;
  /** Rendered speaker-profile lines (E-19: `renderProfileLines`) — always starts
   *  with the L1 line, then recurring errors and rates. */
  profileLines?: readonly string[];
  /** Active slips to steer the conversation toward (their correction phrases). */
  slipTargets?: readonly string[];
  /** Today's composer targets to work in (short human labels). */
  todayTargets?: readonly string[];
}

function bulletBlock(title: string, items: readonly string[]): string | null {
  const clean = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (clean.length === 0) return null;
  return [title, ...clean.map((s) => `- ${s}`)].join("\n");
}

/**
 * Build the tutor persona's full system instruction (E-34). Assembles, in order:
 * the role, the register line (D-23), the speaker profile (E-19, L1 first), the
 * active slips to steer toward, today's targets, the conversational stance
 * (correction-forward, D-18 — correct gently, never rehearse the error as a drill),
 * and the `log_evidence` tool contract. Bounded blocks are omitted when empty, so a
 * fresh learner gets a clean, minimal persona.
 */
export function buildTutorPersona(input: TutorPersonaInput): string {
  const register = coerceRegister(input.register);
  const parts: string[] = [
    `You are Erika, a warm, exacting ${input.targetLanguage} conversation tutor for an advanced learner whose native language is ${input.nativeLanguage}.`,
    registerInstruction(register),
  ];

  const profile = (input.profileLines ?? []).map((s) => s.trim()).filter(Boolean);
  if (profile.length > 0) {
    parts.push(["What you know about this learner:", ...profile].join("\n"));
  }

  const slips = bulletBlock(
    "Recurring mistakes to steer the conversation toward (help them self-correct — never quiz them on the wrong form):",
    input.slipTargets ?? [],
  );
  if (slips) parts.push(slips);

  const today = bulletBlock("Today's targets to work into the conversation naturally:", input.todayTargets ?? []);
  if (today) parts.push(today);

  parts.push(
    "Keep the learner talking; correct gently and specifically. When you correct, say the correct form clearly once and move on — never make the learner repeat their own error (their mistakes are never the drill).",
    // The log_evidence tool contract (WO criterion 3). The tool schema is in the
    // session config; this tells the model WHEN to call it and on WHAT ids.
    "As the conversation goes, call the `log_evidence` function to record what the learner produces — both errors and successes — as structured evidence. Use the grammar rule id or the lemma id you are given for a target; set polarity to correct or incorrect from what they actually said, and mode to spontaneous when unprompted or cued when you prompted them. Do not invent ids; only log evidence for the ids provided in this instruction.",
  );

  return parts.join("\n\n");
}
