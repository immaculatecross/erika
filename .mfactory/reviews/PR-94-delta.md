# PR #94 mandatory delta re-review

- PR: https://github.com/immaculatecross/erika/pull/94
- Repaired SHA: `905dad2e4b66acdbf28c5f3c297c9bd482f111e0`
- Repair base: `94d90acd35c35302ee92d31b786aeb2deed35c52`
- Review tier: Full delta
- Verdict: **REQUEST CHANGES**
- Native GitHub review: https://github.com/immaculatecross/erika/pull/94#pullrequestreview-4781845383
- GitHub state: `COMMENTED` because the authenticated account is the PR author; the body explicitly records `REQUEST CHANGES`.

## Ratchet result

The repair closes four original implementation harms, but the fifth mandatory
readiness harm remains. It also introduces one equal money-safety harm and two
changed tests that cannot fail when the repaired guards they claim to pin are
removed. These are within the re-review ratchet: the readiness defect is the
standing harm-class bug independently reported before repair completed; the other
three findings were introduced by the repair.

This is the second failed review. Per `review.md`, the human operator is now the
appeal path.

## Status of the five blocking harms

### 1. CLOSED — all-English accept / valid Italian reject

The exact original all-English response is now rejected, while
`Mario guarda Luca mentre corre veloce` is accepted. A stricter all-English body
made entirely of one- and two-token fields is also rejected by the aggregate
`$lesson` check. The implementation harm is closed.

The changed test for that aggregate is not mutation-sensitive, however; see new
finding 3.

### 2. CLOSED — keyless vocabulary-only planner omission

The real built route path with `newVocabPerDay: 1`, `newRulesPerDay: 0`,
`newPronPerDay: 0`, and no key selected `lemma:e#CCONJ`, prepared authored
`rule:subject-pronouns`, started successfully, cached the v2 body under the lemma,
and left `spend_ledger` at zero rows. Mutating `chooseLessonItem` to drop vocabulary
made `tests/vocabulary-offline-session.test.ts` fail.

### 3. CLOSED as originally stated — stale reclaim double-call / stale overwrite

The two-minute bound resolves an ordinary held call before the 15-minute claim
threshold, and the ownership token prevents a reclaimed former owner from filling
its successor even when the former owner attempts completion first. In the
deliberately forced two-resolved-call sequence, both calls were committed and the
successor body remained cached.

The repair introduces a distinct timeout-ledger loss, and the changed ownership
test does not prove the token predicate; see new findings 2 and 4.

### 4. CLOSED — named malformed/false syllabus content

The three named corrections are present and independently asserted:

- `congiuntivo-congiunzioni`: `richiedono`, not `richiedano`;
- `connettivi-causa`: `perché` is normally postposed, while `siccome`/`poiché`
  are often preposed, with examples matching that claim;
- `proverbi-formule-colte`: `Chi troppo vuole nulla stringe`.

The all-266 authored-lesson sweep also passed.

### 5. OPEN — onboarding and abandoned claims still wall Start

`components/onboarding/welcome-flow.tsx:83` still routes directly through
`FIRST_SESSION_PATH` (`lib/onboarding/routing.ts:48`) to `/practice/session`.
The only preparation trigger remains the Learn-home effect at
`app/(app)/practice/page.tsx:45-62`, while
`app/api/session/start/route.ts:21-27` still rejects every non-`ready` state.

On the repaired built server:

- `POST /api/onboarding` → 200;
- routed `/practice/session` → `POST /api/session/start` 409;
- clicking **Try again** → the same 409 and error screen;
- `GET /api/session/lesson` at that moment → 200 with a complete authored lesson.

With an empty abandoned v2 claim, `/api/session` reported `preparing`, Start
returned 409, and lesson GET again returned the complete authored lesson.

Harm: **happy path broken / untruthful artifact** — a fresh keyless learner is
deposited into a permanent retry wall, and an abandoned preparation with already
servable authored content is withheld for 15 minutes.

Assumption: onboarding follows the shipped direct route, or a preparation process
dies after claiming; both are normal supported sequences.

Ratchet classification: **standing harm-class bug the first Full review missed**,
independently reported before this repaired head and explicitly included in the
mandatory delta gate.

## New blocking findings

### 2. BLOCKING — timeout can silently erase a resolved/billable call

`lib/lessons/billing.ts:66-77` races the client against a timer and releases the
reservation whenever the timer wins. A controlled `TextModelClient` ignored abort;
after 120 seconds the reservation was released, then the client resolved. The
ledger remained at zero because the late completion has no observer.

Harm: **contract violation / silent wrong result** — recorded spend understates an
accepted request that completes after the local timeout, weakening the hard cap
exactly on an ambiguous provider outcome.

Assumption: the provider accepts the request and completes or bills it after the
local connection is aborted, or a `TextModelClient` does not honor the optional
signal.

Ratchet classification: **introduced by the repair**.

### 3. BLOCKING — whole-lesson language test cannot fail when its guard is removed

`tests/italian-lesson-language.test.ts:125-132` stays green when only the aggregate
guard at `lib/lessons/italian-language.ts:108-110` is disabled. Under that mutation,
an all-English body composed of one- and two-token fields (`Modal instruction`,
`People speak`, `Choose form`, and similar) is accepted.

Harm: **unreal test** — the committed test claims to prove that short English fields
cannot assemble a passing body, but cannot fail when that repaired mechanism is
removed and the named bypass returns.

Assumption: a later regression removes or bypasses aggregate classification while
retaining per-field checks.

Ratchet classification: **introduced by the repair**.

### 4. BLOCKING — ownership test cannot fail when token ownership is removed

`tests/item-lessons-schema.test.ts:83-108` stays green after removing only
`AND claim_token = ?` from `completeItemLesson`. Under that mutation, if the former
owner resolves before the successor, the stale body fills the successor's row and
the real successor fails. The committed test resolves the winner first, so
`body = ''` masks the missing ownership guard.

Harm: **unreal test** — the suite claims to pin ownership but passes when
stale-preemption and stale-result delivery are restored.

Assumption: a later refactor drops the token predicate while preserving the
empty-body predicate.

Ratchet classification: **introduced by the repair**.

## Verification

- Read the complete one-commit repair delta and every touched source/test file.
- PR head and reviewed SHA matched; GitHub `gates` check passed.
- Exact original language adversaries: English rejected; valid Italian accepted.
- Additional all-two-token English body: rejected in current code, accepted when
  the aggregate guard was mutated off.
- Vocabulary-only built product path: lemma selected, authored rule served, Start
  200, zero spend, one non-empty v2 cache body.
- Held/reclaimed-call sequence: every deliberately resolved call committed; the
  current token guard prevented stale-first completion and stale overwrite.
- Timeout-late-resolution sequence: call resolved after timeout; zero ledger rows
  remained.
- Three named syllabus corrections inspected and exact assertions passed.
- All 266 authored rules passed language and complete-lesson generation checks.
- Built onboarding → first-session path and abandoned-claim path reproduced as
  blocking above.
- Disposable built database only:
  `/var/folders/h3/6g7s8fj91b18l5sl281mzryh0000gn/T/erika-pr94-delta-built-4pqkCv/erika.db`.
- Built-server identity proven: build
  `sIjm1FsG62UV6TnIUH_PF`, random port `51361`, and its matching
  `/_next/static/.../_buildManifest.js` returned 200.
- `npm run lint` passed with the three pre-existing unused-import warnings in
  `lib/analysis/audio-model.ts`.
- `npm run typecheck` passed.
- `npm run test` passed: 161 files, 1518 passed, 3 skipped.
- `npm run build` passed with the pre-existing dynamic-dependency warning from
  `lib/speaker/sherpa-embedder.ts`.
- `.mfactory/hooks/run-tripwires.sh --all` passed.

I tried hardest to break the repaired language aggregate, vocabulary-only route
boundary, ownership ordering, timeout billing, authored corrections, and the built
onboarding-to-first-session path.
