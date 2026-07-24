import type { PronunciationDrill } from "./drills";

// What to listen for, without any scorer at all (E-37, D-21/D-19).
//
// THIS IS THE PRIMARY PATH, not a fallback. The critical capability is DETECTION, and
// detection already exists: the deep pass flags pronunciation suspects (the
// `pronunciation` category and the `notes.pronunciation` richness note) from the
// learner's own recordings. The critical loop is then HEAR IT CORRECTLY → SAY IT BACK.
// Both work with no Azure key, no score, and no additional spend beyond the native
// rendition E-33 already caches under the same cap.
//
// Azure Pronunciation Assessment is an OPTIONAL enhancement on top of this, for
// specialised drills only. The studio is complete without it.
//
// The honesty rule this module exists to enforce: an LLM's impression of how something
// sounded is a NOTE, NEVER A SCORE (D-21 — phone-level judgments from audio LLMs are
// unreliable, `docs/research/spike-3`). So the guidance below is always phrased as
// something to attend to, never as a measurement, and it never invents a diagnosis
// where the model gave none.

/** One line of qualitative guidance, plus where it came from. */
export interface DrillGuidance {
  /** The sentence shown above the recorder. */
  text: string;
  /** `flag` — the deep pass named a specific suspect. `general` — it did not, so the
   *  line is generic and says nothing specific about this learner. */
  basis: "flag" | "general";
}

/**
 * What to listen for on this drill. When the deep pass flagged a specific suspect
 * (gemination, a vowel aperture, stress), that flag IS the guidance, quoted as the
 * impression it is. Otherwise the line is a plain instruction to compare — honest that
 * nothing specific was noticed, rather than manufacturing a detail.
 *
 * Pure: no model call, no I/O. The text is the studio's, not a model's prose.
 */
export function whatToListenFor(drill: Pick<PronunciationDrill, "suspect">): DrillGuidance {
  const suspect = drill.suspect?.trim();
  if (suspect) {
    return {
      basis: "flag",
      text: `Erika noticed: ${suspect}. Listen for that, then say the line back.`,
    };
  }
  return {
    basis: "general",
    text: "Play the line, listen to the rhythm and the vowels, then say it back and compare.",
  };
}

/** The one line that keeps an unscored take honest: comparing is real practice, and
 *  nobody is claiming a measurement. Shown wherever a take is recorded without a
 *  score (which, without an Azure key, is every take). */
export const UNSCORED_NOTICE =
  "Nothing here is scored — you are comparing your take with the native rendition. " +
  "Erika will not put a number on your pronunciation unless it measured one.";
