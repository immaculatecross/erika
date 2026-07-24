import { profileBlock, type SpeakerProfile } from "./profile";

// The prompt builders for the two audio-model calls (D-3, D-10), factored out of
// lib/analysis/audio-model.ts to keep that file under the 500-line hook. Pure
// string builders — no I/O, no network — and re-exported from audio-model.ts so the
// import surface the cascade and tests use is unchanged. The E-28 richness dial
// loosened the triage bar and enriched the deep prompt (notes + produced lemmas).

/** The profile block as prompt lines — empty when no profile was provided. */
function profileLines(profile?: SpeakerProfile): string[] {
  return profile ? [profileBlock(profile)] : [];
}

export function triagePrompt(targetLanguage: string, profile?: SpeakerProfile): string {
  return [
    `You are triaging a language learner's ${targetLanguage} speech. The audio is time-compressed.`,
    ...profileLines(profile),
    "Focus ONLY on the dominant/primary speaker; ignore background or bystander voices.",
    "Decide whether the dominant speaker makes any non-native error (grammar, vocabulary,",
    "phrasing, idiom, or pronunciation), OR anything even slightly borderline — a hesitation, an",
    "awkward phrasing, a word that is almost right — worth a closer listen.",
    // Loosened bar (E-28, D-20): the deep pass is the safety net, so err toward
    // flagging. A false flag costs one deep-listen; a missed error is lost signal.
    "When in doubt, flag it. Only pass a segment as clear when the speaker is plainly, fluently correct.",
    'Respond with JSON only: {"flagged": boolean, "reason": string}.',
  ].join(" ");
}

/**
 * Appended on the one repair retry. The models have no JSON response_format, so
 * the only lever is the wording — and a reply that arrived wrapped in prose or a
 * fence usually complies when asked this bluntly.
 */
export const STRICT_JSON_INSTRUCTION =
  "IMPORTANT: your previous reply could not be parsed. Reply with the raw JSON object ONLY —" +
  " no prose, no explanation, no markdown code fence, nothing before the opening brace or after" +
  " the closing brace. Keep it short enough to finish.";

// The dominant-speaker instruction is prompt-level for v1; true voice enrollment
// and diarization are E-13. Tests assert this instruction is present.
export const DOMINANT_SPEAKER_INSTRUCTION =
  "Focus ONLY on the dominant/primary speaker; ignore background or bystander voices (bystanders are never analyzed).";

/** Asked only when the profile carries numbered entries the model can cite. */
export const RECURRENCE_INSTRUCTION =
  'If a finding repeats one of the numbered recurring errors above, add "recurrenceId" with' +
  ' that entry\'s id (e.g. "R1") to that finding. Omit it otherwise.';

/**
 * The enriched-observation instruction (E-28, D-20). Each finding MAY carry an
 * optional `notes` object with three optional string fields: a pronunciation
 * suspect (flagged in TEXT only — gemination, vowel aperture, stress; D-21, never a
 * score), an italiano-colto register upgrade (D-23), and a disfluency note. These
 * are annotations on the finding, not a new category — omit any field with nothing
 * to say, and omit `notes` entirely for a plain finding.
 */
export const ENRICHED_NOTES_INSTRUCTION =
  'Each finding MAY include an optional "notes" object: {"pronunciation": string (a suspected' +
  " mispronunciation — gemination, vowel aperture, or stress; a note, never a score)," +
  ' "register": string (a more elevated, italiano-colto way to say it), "disfluency": string' +
  ' (a filler, false start, or hesitation)}. Include only the fields that apply; omit "notes" if none do.';

/**
 * The positive-production instruction (E-28, D-19). Beyond errors, report the
 * lemmas the speaker used CORRECTLY and well, so Record teaches the model the
 * user's real vocabulary, not only their mistakes. Each is a dictionary citation
 * form plus a coarse POS tag from the closed scheme.
 */
export const PRODUCED_LEMMAS_INSTRUCTION =
  'Also add a top-level "produced" array of the notable words the dominant speaker used CORRECTLY' +
  ' and idiomatically: [{"lemma": string (the dictionary citation form, lower-case), "pos": string' +
  " (one of NOUN, PROPN, VERB, AUX, ADJ, ADV, PRON, DET, ADP, CCONJ, INTJ)}]. Prefer content words" +
  " (nouns, verbs, adjectives, adverbs). Use [] if there is nothing notable.";

export function deepPrompt(targetLanguage: string, profile?: SpeakerProfile): string {
  const hasEntries = (profile?.entries.length ?? 0) > 0;
  return [
    `You are an expert ${targetLanguage} coach reviewing a learner's speech at native speed.`,
    ...profileLines(profile),
    DOMINANT_SPEAKER_INSTRUCTION,
    "Identify each genuine error the dominant speaker makes. For each, give the quote, a correction,",
    "a category (one of: grammar, vocabulary, phrasing, idiom, pronunciation), a short explanation,",
    "a severity (high, medium, low), and its approximate start/end time within this clip in",
    "milliseconds (relStartMs, relEndMs).",
    'Respond with JSON only: {"findings": [{"quote": string, "correction": string,',
    '"category": string, "explanation": string, "severity": string, "relStartMs": number,',
    '"relEndMs": number}], "produced": [{"lemma": string, "pos": string}]}.',
    "Return an empty findings array if the speaker made no errors.",
    ENRICHED_NOTES_INSTRUCTION,
    PRODUCED_LEMMAS_INSTRUCTION,
    ...(hasEntries ? [RECURRENCE_INSTRUCTION] : []),
  ].join(" ");
}
