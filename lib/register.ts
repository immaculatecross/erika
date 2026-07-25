// The register dial (E-33, D-23). One client-safe module — pure strings, no I/O —
// so every generation surface (analysis recasts, lesson generation, TTS voice
// style, and the E-34 tutor persona) injects the SAME register instruction from
// one place. The dial is the learner's control over HOW Italian is phrased, never
// WHAT is correct: it changes style/register only, so a colto recast and a
// colloquiale recast of the same error both fix the same mistake (WO criterion 1).
//
// D-23 settles the ladder: colloquiale → standard → colto → letterario, DEFAULT
// colto ("italiano colto" — elevated contemporary Italian, "Dante-level" as an
// ambition, no archaisms). The WO names the endpoints (colloquiale→letterario,
// default colto); the four D-23 stops are the dial's positions.

/** The register ladder, easiest/plainest → most elevated (D-23). Default is colto. */
export const REGISTERS = ["colloquiale", "standard", "colto", "letterario"] as const;
export type Register = (typeof REGISTERS)[number];

/** The default register (D-23): italiano colto. */
export const DEFAULT_REGISTER: Register = "colto";

export function isRegister(x: unknown): x is Register {
  return typeof x === "string" && (REGISTERS as readonly string[]).includes(x);
}

/** Coerce an untrusted value to a Register, falling back to the default. */
export function coerceRegister(x: unknown): Register {
  return isRegister(x) ? x : DEFAULT_REGISTER;
}

// Per-register descriptions, shared by the text-prompt and TTS builders. Each is a
// short, self-contained gloss of the register's feel — elevated but always living
// and idiomatic contemporary Italian, never archaic (D-23).
const DESCRIPTION: Record<Register, string> = {
  colloquiale:
    "a colloquial, everyday register — relaxed and conversational, the way friends actually speak, natural and idiomatic",
  standard: "a standard, neutral register — clear and correct, neither casual nor elevated",
  colto:
    "an elevated, cultured register (italiano colto) — precise, refined, and idiomatic contemporary Italian, no archaisms",
  letterario:
    "a literary register — the most elevated and expressive contemporary literary style, still living and idiomatic, no archaisms",
};

/**
 * The register instruction injected into every TEXT generation prompt (analysis
 * recasts, lesson generation, the tutor persona).
 *
 * [E-42 criterion 12] THE ONE STATEMENT ABOUT WHAT THE DIAL DOES. Three places used
 * to say two different things: this function said the dial "never [changes] what is
 * correct"; `lib/mistakes.ts` class B says a plain register mismatch IS a mistake;
 * and `lib/analysis/prompts.ts` restated the first claim in a comment. A composed
 * prompt that contradicts itself is worse than either half alone, because the model
 * resolves the contradiction however it likes and we never find out which way.
 *
 * The resolution, stated ONCE here and referenced everywhere else: **the dial sets
 * the target register a slip is judged against; it never overrides grammatical
 * correctness.** That is D-23's "style only, never correctness" read precisely — the
 * dial does not make a wrong form right or a right form wrong, it decides which of
 * several correct ways to say something belongs here. PRODUCT.md leads with catching
 * "phrasing a native would never choose", so a word plainly outside the chosen
 * register is a real finding; it is a WORD-CHOICE finding, filed under `vocabulary`
 * (lib/analysis/findings.ts), and therefore cardable exactly like any other
 * vocabulary finding — no new category, no separate drill path (criterion 14).
 */
export function registerInstruction(register: Register): string {
  return `Write in the "${register}" register of Italian: ${DESCRIPTION[register]}. This register is the target: every correction, example, and answer must be accurate AND natural in it, and a word or turn of phrase plainly outside it counts as a word-choice mistake. It never overrides what is grammatically correct — it decides which of several correct ways to say something belongs here.`;
}

/**
 * The register instruction injected into a TTS synthesis call (the render engine's
 * voice/style — WO criterion 1). Steers delivery, not content: the same phrase is
 * spoken in the register's manner. gpt-4o-mini-tts takes a free-text `instructions`
 * field for exactly this.
 */
export function registerTtsInstruction(register: Register): string {
  const delivery: Record<Register, string> = {
    colloquiale: "a relaxed, conversational pace, as in everyday speech",
    standard: "a clear, neutral, even delivery",
    colto: "a measured, articulate, refined delivery",
    letterario: "an expressive, unhurried delivery, as if reading fine prose aloud",
  };
  return `Speak in clear, natural Italian with ${delivery[register]}. Correct pronunciation and native rhythm; this is a pronunciation model for a learner.`;
}
