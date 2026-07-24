import type { Db } from "../db";
import { isPos } from "../lexicon/pos";
import { attestsLemma } from "../lexicon/morphit";
import { ensureLemmaItem, recordEvidence, UnvalidatedLemmaError } from "../knowledge";
import type { ProducedLemma } from "./audio-model";

// Positive production evidence (E-28, D-19). The deep pass reports the lemmas the
// speaker used CORRECTLY (`produced`); this module turns each attested one into a
// discounted spontaneous-correct `evidence` row through the SAME knowledge write
// path E-25 built — Record teaches the model the user's real vocabulary, not only
// their errors, and a recording-attested lemma is thereby marked (the derived
// `recording_attested` flag) so the future daily composer (v0.5/E-31) excludes it
// from new-item selection.
//
// The morph-it gate is absolute (D-13): a lemma the validator does not attest — a
// misspelling, a hallucination, a wrong POS — is DROPPED, never minted. `ensureLemmaItem`
// and `recordEvidence` both re-check morph-it, so an unattested pair cannot slip
// through even if this filter were wrong.
//
// E-17 SCOPE: this runs ONLY after a segment's deep-listen has persisted its
// findings + completion witness (lib/analysis/cascade.ts), i.e. for a segment whose
// audio now carries a complete analysis witness — the included-finding scope. It is
// never called on a cache hit or a cache-reuse clone, so a given audio's production
// is recorded exactly once, when it was actually listened to.

/**
 * Record every attested produced lemma as one ×0.7-discounted, spontaneous,
 * correct, finding-sourced evidence row for `sessionId`. Unattested/garbage lemmas
 * are silently dropped. Never throws — a knowledge-write hiccup must not fail the
 * analysis run (D-13); returns the number of evidence rows actually written.
 */
export function recordProducedLemmas(db: Db, sessionId: string, produced: ProducedLemma[]): number {
  let written = 0;
  for (const { lemma, pos } of produced) {
    // morph-it citation forms are lower-case; the model may capitalize.
    const canonical = lemma.toLowerCase();
    if (!isPos(pos) || !attestsLemma(canonical, pos)) continue; // unattested → drop
    try {
      const itemId = ensureLemmaItem(db, canonical, pos);
      recordEvidence(db, {
        itemId,
        source: "finding",
        sourceRef: null,
        polarity: 1, // used it correctly
        mode: "spontaneous", // unprompted, in real speech
        audioDerived: true, // a recording — the ×0.7 discount applies
        sessionId,
      });
      written += 1;
    } catch (err) {
      // An unattested pair (UnvalidatedLemmaError) is expected and dropped; any
      // other write error is swallowed so it never fails the run (D-13).
      if (!(err instanceof UnvalidatedLemmaError)) {
        // Intentionally quiet: enrichment is best-effort, not money or findings.
      }
    }
  }
  return written;
}
