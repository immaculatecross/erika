import { registerInstruction, coerceRegister, type Register } from "../register";
import { mistakeClasses, precisionCore } from "../mistakes";

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
// about naming mistakes at all, so the tutor only flagged errors by accident. It gained
// an explicit mandate (ERROR_FLAGGING_MANDATE), a precision guardrail (D-19: never
// invent an error), and in-the-flow correction rules so thoroughness does not turn the
// tutor into a nag (D-18, D-24). These are prompt strings: the tests assert their
// CONTENT, not the model's behaviour.
//
// Rebalanced (E-39 workstream A): that mandate ranked final-vowel / -o/-a agreement as
// the single "highest priority", put "grammar and word choice" third, and never named
// vocabulary at all — the operator's -o/-a EXAMPLE encoded as the spec, with whole
// categories ranked beneath it. The mandate now composes `lib/mistakes.ts`, the one
// shared definition of what counts as a mistake, which the Record deep prompt composes
// too: three peer classes (grammar, vocabulary/word choice, pronunciation) with -o/-a
// agreement as one worked example inside the agreement bullet. Every guardrail is
// unchanged and the per-turn cap is unchanged — wider COVERAGE, not more interruptions;
// the cap is what makes the wider net safe, so it must never be traded for it.
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
 * job, and `lib/mistakes.ts` says which mistakes those are: three PEER classes —
 * grammar, vocabulary/word choice, pronunciation — with -o/-a agreement as one
 * worked example of the final-vowel case rather than a class of its own ranked above
 * the rest. Register-neutral by construction: it says WHAT counts as an error, never
 * HOW to speak, so it composes with the D-23 register line rather than competing
 * with it (and the register line still comes first — the one register CLAUSE here
 * defers to it explicitly rather than restating it).
 *
 * Deliberately DEFINITIONAL ("all of the following count as real errors") rather than
 * an imperative to flag each one: how many to voice per turn is IN_THE_FLOW's job,
 * and an unqualified "flag every one" would override it. That distinction matters
 * more now that the list is three times longer, not less.
 */
const ERROR_FLAGGING_MANDATE = [
  "Finding and naming the learner's mistakes is your most important job. Listen closely to everything they say and actively flag what is wrong — do not politely let errors slide. When you correct, name what they said and give the correct form: \"you said la ragazzo — it's il ragazzo\".",
  mistakeClasses(),
].join("\n");

/**
 * The precision guardrail (D-19: honesty). Thorough about REAL errors is the goal;
 * inventing errors to look useful is the failure mode this text exists to block. The
 * text is `PRECISION_CORE_LINES` in lib/mistakes.ts, shared verbatim with the Record
 * deep prompt: the guardrail travels with the class list it bounds, so a future
 * widening of one cannot leave the other behind. See that module for what each of
 * its three clauses closes (audibility, the speaker's gender, degree).
 */
const PRECISION_GUARDRAIL = precisionCore();

/**
 * Correct in the flow, not in a lecture (D-24 calm, D-18 correction-forward). The
 * mandate above makes the tutor thorough; this keeps it a conversation partner. The
 * cap is per LEARNER TURN and countable on purpose: a comparative preference ("take
 * the most important one") loses to the mandate's superlatives, and a ranking of
 * classes alone is silent on the common case of several errors of the SAME kind in one
 * turn. The closing clause is the load-bearing one — it tells the model that passing
 * over fluent speech in silence is success, which is what neutralises "do not
 * politely let errors slide".
 *
 * E-39: the selection rule used to be "a final-vowel or agreement error outranks the
 * rest", which re-imposed inside the cap the very ranking the mandate had just dropped
 * — it would have had the tutor pass over a false friend that changed the sentence's
 * meaning in favour of a blurred ending. It is now class-neutral and stated in terms of
 * the LEARNER's cost: what most obstructs being understood, or what looks like a habit
 * rather than a one-off. The cap itself is untouched at one per turn; a three-times
 * longer list of what counts makes that cap more load-bearing, not less.
 */
const IN_THE_FLOW =
  "Stay a conversation, not a lecture. Correct in the flow: name the error in a few words, give the correct form, and carry the conversation onward in the same breath — never stop to teach a mini-lesson after every sentence. Correct at most one error per learner turn — the one that most gets in the way of being understood, or that looks like a habit rather than a one-off, whichever of the three classes it belongs to — and let everything else go, even when several of them are of the same kind; a stretch of fluent speech you pass over in silence is a good conversation, not a missed job. Do not re-drill an error you have already corrected in this session; if it comes back, remind them of the correct form once more at most, then let it go for the rest of the call — a recurring error is signal to record with `log_evidence` (when it is one of the ids you were given), not a reason to keep correcting.";

/**
 * [E-43 / D-28] THE REPLY IS TEXT THAT WILL BE SPOKEN, and the model has to know it.
 *
 * The tutor now answers with `output_modalities: ["text"]` and that text goes straight
 * into TTS. A model writing for a screen produces bullet lists, bold, headings and
 * parenthetical asides — all of which a voice reads out as literal punctuation or as
 * an oddly-paced monotone. Nothing else in the persona would have stopped it, and no
 * test would have caught it: the text would be perfectly good text.
 *
 * It does NOT touch a single guardrail, and deliberately does not restate the register
 * line (D-23 governs word choice through this leg, and must not be re-implemented as
 * TTS prosody — Amendment 2).
 */
const SPOKEN_OUTPUT = [
  "Everything you write is spoken aloud to the learner — they hear it, they never read it.",
  "So write plain spoken Italian: no markdown, no bullet points, no headings, no emoji, no stage directions, no parentheses full of asides, and never spell out formatting.",
  "Keep each turn short, the length of something a person would actually say in conversation — a couple of sentences, not a paragraph.",
  // Found by driving the live tutor in a browser: it narrated its own bookkeeping out
  // loud — "un momento, registro un dettaglio su ciò che hai detto", "mi concentro su
  // una correzione chiave e poi continuiamo". The learner heard the machinery instead
  // of a conversation, and it cost a whole spoken sentence of latency before anything
  // useful was said. Nothing else in the persona forbade it.
  "Never mention or narrate your own tools, notes or bookkeeping, and never announce what you are about to do. Do not say that you are recording, noting or focusing on anything — just say the thing itself. Calling `log_evidence` is silent and invisible to the learner: it is never spoken about, before or after.",
].join(" ");

/**
 * What Erika says first. Sent once as the instruction for the opening response, so the
 * learner is greeted instead of meeting silence — the single most important affordance
 * on a voice surface, and the one nothing in the old tutor supplied. The persona
 * governs everything after it.
 */
export const TUTOR_OPENING =
  "Greet the learner warmly in Italian in one short sentence, then ask them one open question to get them talking. Do not explain what you are or how this works.";

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
    SPOKEN_OUTPUT,
    "Keep the learner talking; correct plainly and specifically. When you correct, say the correct form clearly once and move on — never make the learner repeat their own error (their mistakes are never the drill).",
    // The log_evidence tool contract (WO criterion 3). The tool schema is in the
    // session config; this tells the model WHEN to call it and on WHAT ids.
    "As the conversation goes, call the `log_evidence` function to record what the learner produces — both errors and successes — as structured evidence. Use the grammar rule id or the lemma id you are given for a target; set polarity to correct or incorrect from what they actually said, and mode to spontaneous when unprompted or cued when you prompted them. Do not invent ids; only log evidence for the ids provided in this instruction.",
  );

  return parts.join("\n\n");
}
