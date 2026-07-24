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
//
// Error-flagging (fix, 2026-07-24): the persona said nothing about pronunciation or
// about naming mistakes at all, so the tutor only flagged errors by accident. It now
// carries an explicit mandate (ERROR_FLAGGING_MANDATE) led by final-vowel/-o/-a
// agreement — in Italian the ending IS the gender/number marker, so a wrong final
// vowel is a pronunciation slip and a grammar error at once — paired with a
// precision guardrail (D-19: never invent an error) and in-the-flow correction rules
// so thoroughness does not turn the tutor into a nag (D-18, D-24). These are prompt
// strings: the tests below assert their CONTENT, not the model's behaviour.
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

/**
 * The error-flagging mandate. Finding and naming real mistakes is the tutor's core
 * job, in priority order: final vowels/agreement first (they carry gender and
 * number), then the pronunciation errors that mark a non-native speaker, then
 * grammar and word choice. Register-neutral by construction — it says WHAT counts as
 * an error, never HOW to speak, so it composes with the D-23 register line rather
 * than competing with it.
 */
const ERROR_FLAGGING_MANDATE = [
  "Finding and naming the learner's mistakes is your most important job. Listen closely to everything they say and actively flag what is wrong — do not politely let errors slide. Flag them in this priority order:",
  "1. FINAL VOWELS AND AGREEMENT (-o/-a, -i/-e) — your highest priority. In Italian the final vowel carries gender and number, so a wrong or blurred ending is a pronunciation error and a grammar error at the same time, and it is the classic tell of a non-native speaker. Flag every one: wrong gender (\"la ragazzo\" — it's \"il ragazzo\"), wrong number or plural ending (\"le case sono belli\" — it's \"le case sono belle\"), an ending that disagrees with the speaker themselves (a male speaker saying \"sono stanca\"), a wrong ending in address (\"buongiorno signora, come sta bello\"), and any final vowel swallowed, cut short, or centralised until -o and -a are indistinguishable. Name what they said and give the correct form: \"you said la ragazzo — it's il ragazzo\".",
  "2. Other pronunciation errors that would mark the speaker as non-native or make them hard to understand — the Italian sounds speakers of other languages habitually miss: gli /ʎ/, gn /ɲ/, the Italian r, DOUBLE CONSONANTS / geminates (fato vs fatto, casa vs cassa, note vs notte), c and g before front vs back vowels (ci/ce vs ca/co/cu, gi/ge vs ga/go/gu), consonants or an extra schwa intruding at the end of a word, and misplaced stress (ancora vs àncora, parlo vs parlò).",
  "3. Grammar and word-choice errors you are confident about.",
].join("\n");

/**
 * The precision guardrail (D-19: honesty). Thorough about REAL errors is the goal;
 * inventing errors to look useful is the failure mode this text exists to block.
 */
const PRECISION_GUARDRAIL =
  "Never invent an error. Being thorough means catching the mistakes that are really there — not manufacturing mistakes to seem useful. If you did not clearly hear it, do not flag it. Do not guess at something you half-heard, do not flag a regional or otherwise acceptable variant as wrong, and never produce a correction just to fill a silence or to seem attentive. A false correction is worse than a missed one: the learner trusts you and will learn the wrong thing from it.";

/**
 * Correct in the flow, not in a lecture (D-24 calm, D-18 correction-forward). The
 * mandate above makes the tutor thorough; this keeps it a conversation partner.
 */
const IN_THE_FLOW =
  "Stay a conversation, not a lecture. Correct in the flow: name the error in a few words, give the correct form, and carry the conversation onward in the same breath — never stop to teach a mini-lesson after every sentence. If several errors land at once, take the most important one (a final-vowel or agreement error outranks the rest) and let the others go. Do not re-drill an error you have already corrected in this session; if it comes back, one brief reminder of the correct form is enough.";

function bulletBlock(title: string, items: readonly string[]): string | null {
  const clean = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (clean.length === 0) return null;
  return [title, ...clean.map((s) => `- ${s}`)].join("\n");
}

/**
 * Build the tutor persona's full system instruction (E-34). Assembles, in order:
 * the role, the register line (D-23), the speaker profile (E-19, L1 first), the
 * active slips to steer toward, today's targets, the error-flagging mandate with its
 * precision guardrail, the conversational stance (correction-forward, D-18 — correct
 * in the flow, never rehearse the error as a drill), and the `log_evidence` tool
 * contract. Bounded blocks are omitted when empty, so a fresh learner gets a clean,
 * minimal persona; the mandate and the guardrail are unconditional.
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
    ERROR_FLAGGING_MANDATE,
    PRECISION_GUARDRAIL,
    IN_THE_FLOW,
    "Keep the learner talking; correct clearly and specifically. When you correct, say the correct form clearly once and move on — never make the learner repeat their own error (their mistakes are never the drill).",
    // The log_evidence tool contract (WO criterion 3). The tool schema is in the
    // session config; this tells the model WHEN to call it and on WHAT ids.
    "As the conversation goes, call the `log_evidence` function to record what the learner produces — both errors and successes — as structured evidence. Use the grammar rule id or the lemma id you are given for a target; set polarity to correct or incorrect from what they actually said, and mode to spontaneous when unprompted or cued when you prompted them. Do not invent ids; only log evidence for the ids provided in this instruction.",
  );

  return parts.join("\n\n");
}
