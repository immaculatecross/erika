import type { Db } from "../db";
import { isPos } from "../lexicon/pos";
import { attestsLemma } from "../lexicon/morphit";
import { ensureLemmaItem, recordProducedEvidence, UnvalidatedLemmaError } from "../knowledge";
import { bumpYield } from "../knowledge/yield";
import type { ProducedLemma } from "./audio-model";

/** Options gating a produced-lemma write (E-36). */
export interface RecordProducedOpts {
  /**
   * Suppress ALL positive credit for this segment — it was attributed to a non-user
   * speaker (D-22) or its session is manually excluded ("not me"). Nothing is
   * written, but the emit is still counted as DROPPED so the yield stays honest.
   */
  suppress?: boolean;
}

/**
 * The stable idempotency key for one produced-lemma positive (E-36): the session,
 * the segment's content hash (the audio identity — so the SAME audio reused across
 * sessions keys per session), and the canonical lemma#POS. A replayed deep-listen of
 * the same segment re-emits this exact key, and the partial UNIQUE index makes the
 * `INSERT OR IGNORE` a no-op, so no duplicate row is ever appended.
 */
export function producedSourceRef(sessionId: string, contentHash: string, lemma: string, pos: string): string {
  return `${sessionId}:${contentHash}:${lemma}#${pos}`;
}

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
 * Record every attested produced lemma as one ×0.7-discounted, spontaneous, correct,
 * finding-sourced evidence row for `sessionId`, keyed to the segment's `contentHash`.
 * Unattested/garbage lemmas are silently dropped, and a REPLAY of the same segment
 * appends nothing (the idempotency key + partial UNIQUE index; E-36). Never throws —
 * a knowledge-write hiccup must not fail the analysis run (D-13); returns the number
 * of evidence rows actually appended (a deduped or suppressed emit counts as 0).
 *
 * SUPPRESSION (E-36, D-22): when `opts.suppress` is set — the segment was attributed
 * to a NON-USER speaker, or its session is manually excluded — no positive credit is
 * minted at all (a bystander is never credited as the user), yet the emits are still
 * counted as DROPPED so the yield instrumentation stays honest.
 */
export function recordProducedLemmas(
  db: Db,
  sessionId: string,
  contentHash: string,
  produced: ProducedLemma[],
  opts: RecordProducedOpts = {},
): number {
  const emitted = produced.length;
  let written = 0;

  if (!opts.suppress) {
    for (const { lemma, pos } of produced) {
      // morph-it citation forms are lower-case; the model may capitalize.
      const canonical = lemma.toLowerCase();
      if (!isPos(pos) || !attestsLemma(canonical, pos)) continue; // unattested → drop
      try {
        const itemId = ensureLemmaItem(db, canonical, pos);
        const appended = recordProducedEvidence(db, {
          itemId,
          sessionId,
          sourceRef: producedSourceRef(sessionId, contentHash, canonical, pos),
        });
        if (appended) written += 1; // a deduped replay is not a fresh attestation
      } catch (err) {
        // An unattested pair (UnvalidatedLemmaError) is expected and dropped; any
        // other write error is swallowed so it never fails the run (D-13).
        if (!(err instanceof UnvalidatedLemmaError)) {
          // Intentionally quiet: enrichment is best-effort, not money or findings.
        }
      }
    }
  }

  // [RETRO-002 T2] Record the yield so a near-empty attestation rate — and now a
  // suppressed/deduped emit — is visible in the dev knowledge inspector rather than
  // silent. A suppressed or deduped emit is counted as DROPPED, never attested.
  // Best-effort; never fails the run.
  try {
    bumpYield(db, { emitted, attested: written, dropped: emitted - written });
  } catch {
    // observability must never break analysis (D-13).
  }
  return written;
}
