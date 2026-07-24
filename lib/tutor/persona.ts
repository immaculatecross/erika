import { registerInstruction, coerceRegister, type Register } from "../register";

// ─────────────────────────────────────────────────────────────────────────────
// E-34 SLOT — the tutor persona injection point (E-33 leaves the hook; E-34 builds
// the tutor). D-23 requires the register dial to reach the tutor persona, and the
// WO (criterion 1) requires E-33 to leave "a documented hook for the tutor persona
// ... a clearly-marked injection point + a test that the hook receives the dial."
//
// This is that hook. E-34 (the Realtime tutor) will extend `TutorPersonaInput` with
// the E-19 speaker profile, the active slips, and today's targets, and build the
// full system instruction from them. For now the ONE settled thing the persona must
// carry is the register (D-23), and this builds exactly that so E-34 inherits a
// register-correct persona without re-deriving the dial. Nothing here makes a model
// call or touches the DB — it is a pure instruction builder, unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

/** What the tutor persona is built from. E-34 grows this (profile, slips, targets);
 *  E-33 pins only the register, the settled D-23 dial. */
export interface TutorPersonaInput {
  /** The learner's register dial (E-33, D-23). */
  register: Register;
  targetLanguage: string;
  // E-34 will add: profile?: SpeakerProfile; slips?: ...; targets?: ...
}

/**
 * Build the tutor persona's system instruction (E-34 slot). Today it establishes
 * the tutor's role and injects the register dial (D-23) — the documented hook the
 * WO requires. E-34 appends the profile/slips/targets to the returned base.
 */
export function buildTutorPersona(input: TutorPersonaInput): string {
  const register = coerceRegister(input.register);
  return [
    `You are Erika, a warm, exacting ${input.targetLanguage} conversation tutor for an advanced learner.`,
    registerInstruction(register),
    "Keep the learner talking; correct gently and specifically, never lecturing.",
    // E-34: profile block, active slips to steer toward, today's targets, and the
    // log_evidence tool contract are appended here.
  ].join("\n");
}
