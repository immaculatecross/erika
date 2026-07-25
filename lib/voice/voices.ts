// The tutor's voice choice (E-43, D-28's speaking leg). Client-safe pure data — no
// I/O — so Settings, the persona-free speak route and the seam all read ONE mapping.
//
// THE OPERATOR CHOSE THESE BY EAR, AND THAT IS THE WHOLE POINT. D-26 exists partly
// because the Realtime tutor "listens very well, but does not speak super well", so
// picking a voice from a spec sheet would repeat exactly the mistake that caused this
// milestone. spike-5 §2.2 synthesized the same Italian sentence in five renditions
// and deliberately declined to choose; the operator listened and ruled: **`alloy` and
// `nova`** — "the first and last are great, and allow in settings to choose male or
// female."
//
// ⚠️ OpenAI DOES NOT LABEL ITS VOICES BY GENDER, and this file must not pretend it
// does. The male/female mapping below is the operator's ear applied to these two
// specific Italian renditions — a better authority than a datasheet, but not a vendor
// guarantee, and it may not hold for another language or another snapshot.
//
// Only these two are offered. spike-5 lists 13 voices; a dial with 13 positions is
// precisely the "many customizable moving parts" D-26 deletes.

/** How the choice is presented to the learner — the operator's own framing. */
export const TUTOR_VOICE_CHOICES = ["female", "male"] as const;
export type TutorVoiceChoice = (typeof TUTOR_VOICE_CHOICES)[number];

/**
 * The default. **`female` (`nova`)** — the product is named Erika and speaks as
 * Erika throughout its copy and its persona, so the voice that matches its own name
 * is the one a first-time learner will find least surprising. Either operator-chosen
 * voice was acceptable; this one is coherent with everything else on the screen.
 */
export const DEFAULT_TUTOR_VOICE: TutorVoiceChoice = "female";

export function isTutorVoiceChoice(x: unknown): x is TutorVoiceChoice {
  return typeof x === "string" && (TUTOR_VOICE_CHOICES as readonly string[]).includes(x);
}

/** Coerce an untrusted value to a voice choice, falling back to the default. */
export function coerceTutorVoice(x: unknown): TutorVoiceChoice {
  return isTutorVoiceChoice(x) ? x : DEFAULT_TUTOR_VOICE;
}

/**
 * The OpenAI voice id behind each choice. Deliberately PROVIDER-SCOPED and confined
 * to this one map: the seam (`lib/voice/speech.ts`) treats `voice` as an opaque
 * string, so a second vendor supplies its own mapping here and the loop never learns
 * an OpenAI voice name.
 */
export const OPENAI_TUTOR_VOICE_IDS: Record<TutorVoiceChoice, string> = {
  female: "nova",
  male: "alloy",
};

/** A short, honest label for the Settings control. */
export const TUTOR_VOICE_LABELS: Record<TutorVoiceChoice, string> = {
  female: "Female",
  male: "Male",
};
