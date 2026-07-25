// THE one rule for "was this the learner speaking?" (E-36, D-22; E-39 §B1).
//
// WHY THIS FILE EXISTS. E-36 shipped as "credit only the user's speech" and wired
// `is_user` into exactly two places, under two different rules —
// `lib/analysis/cascade.ts` (per-segment, write time, positive evidence only) and
// `lib/today-thread.ts` (per session+hash, read time, citation only). The declared
// single findings gate, `lib/findings-model.ts`, carried **no speaker predicate at
// all**, so another person's mistakes still became the learner's cards, slips, drills,
// Focus rates, patterns, letter and plan. [RETRO-004 Tier 1 §1 / C6]
//
// THE INVARIANT, stated once: **speech attributed to somebody other than the learner
// is not the learner's — it earns them no credit and it is not their mistake.** Both
// halves of that sentence now read this module and nothing else.
//
// THE RULE. Speech is the learner's unless we positively know otherwise:
//
//   * `segments.is_user = 0` — the on-device verifier heard no window resembling the
//     enrolled voice. Excluded.
//   * `segments.is_user IS NULL` — UNATTRIBUTED (no enrollment, filter off, model
//     asset absent, per-segment hiccup). **Counts as the learner** (D-22 recall-first):
//     attribution is a best-effort filter, never a gate that can silence a learner who
//     has not enrolled. On the shipped default every row is NULL, so this rule removes
//     nothing at all until an enrollment take exists.
//   * `sessions.exclude_from_evidence = 1` — the learner said so themselves ("this
//     recording isn't me"). Excluded, and reversibly: flipping the switch back returns
//     everything, so this is never a dead end.
//
// WHAT THE OPPOSITE FAILURE LOOKS LIKE, since that is what v0.6 kept shipping:
// excluding too much — dropping the learner's OWN corrections — is exactly as harmful
// as including a bystander's, and it is the more invisible of the two. Three things
// hold that line: NULL counts as the learner; only a definitive `0` excludes; and the
// manual switch is reversible. `tests/speaker-findings-scope.test.ts` asserts the
// positive direction (an un-enrolled learner, and an `is_user = 1` learner, keep every
// finding) alongside the exclusions.
//
// TWO EVALUATION POINTS, ONE RULE. Where the caller holds the segment row it applies
// `learnerSpoke` directly. Where it holds only the audio's identity — a finding row
// carries `(session_id, content_hash)` and no `segment_id` — it applies the rule over
// every segment carrying that audio in that session. A content hash CAN repeat within
// one session, and contradictory verdicts across copies of byte-identical audio can
// only come from attribution re-run under a different enrollment; the verdict is taken
// over all copies and any `0` excludes, which is the reading of "attributed to somebody
// else" that `lib/today-thread.ts` already shipped. One rule, no second dialect.
// `tests/speaker-findings-scope.test.ts` runs the SQL and the JS forms over the same
// fixture matrix and asserts they agree verdict-for-verdict, so the two cannot drift.

/** The learner-attribution facts about one segment, however the caller obtained them. */
export interface SpeechAttribution {
  /** 1 = the enrolled learner, 0 = another speaker, null/undefined = unattributed. */
  isUser: 0 | 1 | null | undefined;
  /** The owning session's manual "this recording isn't me" switch. */
  excludeFromEvidence: boolean;
}

/** Did the learner speak this? The JS form of the rule (see the header). */
export function learnerSpoke(at: SpeechAttribution): boolean {
  if (at.excludeFromEvidence) return false;
  return at.isUser !== 0;
}

/**
 * Did the learner speak this audio, judged over every segment carrying it? The form
 * for a caller that holds an audio identity rather than one segment row. An empty
 * list is unattributed, not "not the learner" — the segment may simply be gone, and
 * D-22 says an absent verdict counts as the learner.
 */
export function learnerSpokeAnyOf(
  segments: readonly { is_user: 0 | 1 | null }[],
  opts: { excludeFromEvidence: boolean },
): boolean {
  if (opts.excludeFromEvidence) return false;
  return !segments.some((s) => s.is_user === 0);
}

/**
 * SQL form: this audio is the learner's own speech. `sessionIdExpr` and
 * `contentHashExpr` are SQL expressions for the owning session and the audio's
 * content hash (for `findings f`: `f.session_id`, `f.content_hash`). Aliases are
 * prefixed `own_` so the fragment can be interpolated into any query without
 * colliding with the caller's own aliases.
 */
export function learnerSpeechSql(sessionIdExpr: string, contentHashExpr: string): string {
  return `(
    NOT EXISTS (
      SELECT 1 FROM sessions own_s
       WHERE own_s.id = ${sessionIdExpr} AND COALESCE(own_s.exclude_from_evidence, 0) = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM segments own_g
       WHERE own_g.session_id = ${sessionIdExpr}
         AND own_g.content_hash = ${contentHashExpr}
         AND own_g.is_user = 0
    )
  )`;
}

/**
 * SQL form for a query already joined to the segment row itself — the per-segment
 * evaluation point. `isUserExpr` is the segment's `is_user` column; SQLite's `IS NOT`
 * is null-safe, so an unattributed segment passes.
 */
export function learnerSegmentSql(isUserExpr: string, excludeFromEvidenceExpr: string): string {
  return `(${isUserExpr} IS NOT 0 AND COALESCE(${excludeFromEvidenceExpr}, 0) = 0)`;
}
