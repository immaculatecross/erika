# PR #94 exceptional pin delta review

- PR: https://github.com/immaculatecross/erika/pull/94
- Reviewed SHA: `a9e840aa734344638f21e5f86bb5662577616364`
- Repair base: `bf4eb22be3d426f80082c3268439383727c6cbfd`
- Review tier: exceptional Full delta (re-review ratchet)
- Verdict: **APPROVE**
- Native GitHub review: https://github.com/immaculatecross/erika/pull/94#pullrequestreview-4782000247
- GitHub state: `COMMENTED` because the authenticated account is the PR author; the body explicitly records `APPROVE`. Operator must supply formal approval under a non-author reviewer identity if branch protection requires it.

## Ratchet result

The standing blocker from `PR-94-final.md` is **CLOSED**. This repair introduces no new harm-class BLOCKING finding.

## Standing blocker status

### CLOSED — an active preparation can replace the lesson after Start

`POST /api/session/start` now calls `pinServableItemLesson` instead of a read-only servability check. When the selected item has no completed v2 cache body, Start atomically inserts/updates the empty (or off-version) claim with authored Italian, clears `claim_token`, and only then opens the session. Late healthy owners still finalize accepted-call spend once via `finalizeReservation` before `completeItemLesson`, but completion requires `body = '' AND claim_token = ?` and therefore cannot overwrite the pin.

Independent reproduction (vocabulary-only day, disposable DB in review worktree):

1. Settings `newVocabPerDay: 1`, rules/pron 0 → selected `lemma:e#CCONJ`.
2. Healthy unresolved claim: `prepareItemLesson` held the first billed call; row body remained `''`.
3. Start → 200.
4. First lesson GET → authored `rule:subject-pronouns`, `deterministic: true`.
5. Owner resolved valid generated Italian vocabulary JSON.
6. Second lesson GET → **byte-identical** to the first; drills unchanged.
7. Item-complete evidence targeted the served `rule:*` id (`mode: cued`).
8. `spend_ledger` → exactly one `committed` row; model `complete` called once; cache body under the lemma key still taught `rule:subject-pronouns`.

Onboarding and abandoned-claim Start remain model-free and spend-free (focused tests + zero `spend_ledger` rows). Abandoned empty claims are now pinned (non-empty body, `claim_token` null) rather than left empty — intentional for the same freeze.

## New findings

**BLOCKING:** none.

**ADVISORY:** none that meet the severity bar. The designed tradeoff — late successful vocabulary generation is billed once and discarded from the cache in favor of the Start pin — is stated in `docs/schema.md` and is the mechanism that closes the standing silent-wrong-result.

## Changed tests as specifications

- `tests/active-claim-session-stability.test.ts` correctly specifies the standing-blocker sequence: pin before owner resolve, authored `rule:*` stability across lesson GETs, unchanged drills/evidence target, single committed spend, no cache overwrite.
- `tests/item-lessons-schema.test.ts` (`keeps a Start pin…`) correctly specifies that after `pinServableItemLesson`, a still-held owner token cannot `completeItemLesson` over the frozen authored body.
- `tests/abandoned-claim-start.test.ts` now correctly specifies pin-fill + cleared ownership with zero spend (replacing the prior “body stays empty” contract).
- `tests/onboarding-first-session.test.ts` now correctly specifies one non-empty pinned cache row with zero spend (replacing the prior “zero `item_lessons` rows” contract).

## Mutation proofs

1. **Write-free pin** (`pinServableItemLesson` → `servableItemLesson` only): `active-claim-session-stability` failed at the post-Start non-empty body assertion (`expected 0 to be greater than 0`).
2. **Ownership-blind complete** (drop `body = '' AND claim_token = ?` from `completeItemLesson`): `keeps a Start pin…` failed — late owner overwrote the frozen intro/itemId.
3. **Pin keeps `claim_token` + complete drops only `body = ''`**: `keeps a Start pin…` failed — proves clearing ownership is a real defense, not dead code.

All mutations restored; focused tests re-passed.

## Verification

- Worked from detached review worktree `/private/tmp/erika-pr94-pin-review.*` at `a9e840a`; did not mutate the operator parent checkout’s `components/session/drills-step.tsx`.
- Read the complete pin repair diff (`bf4eb22..a9e840a`) and every touched file in full.
- Reviewed SHA matched the PR head.
- GitHub `gates` green at the exact SHA (Actions run `30206960825`).
- Focused suite: `active-claim-session-stability`, `abandoned-claim-start`, `onboarding-first-session`, `item-lessons-schema` — 7 passed.
- Independent route-level repro script (same sequence as the standing blocker) — ok.
- Pin / complete mutations as above; restored clean.

I tried hardest to break post-Start lesson identity under a late healthy owner, spend finalization-without-overwrite, and the sensitivity of the new pin tests.
