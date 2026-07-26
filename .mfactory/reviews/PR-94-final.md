# PR #94 exceptional final delta review

- PR: https://github.com/immaculatecross/erika/pull/94
- Reviewed SHA: `bf4eb22be3d426f80082c3268439383727c6cbfd`
- Repair base: `905dad2e4b66acdbf28c5f3c297c9bd482f111e0`
- Review tier: exceptional Full delta
- Verdict: **REQUEST CHANGES**
- Native GitHub review: https://github.com/immaculatecross/erika/pull/94#pullrequestreview-4781895498
- GitHub state: `COMMENTED` because the authenticated account is the PR author; the body explicitly records `REQUEST CHANGES`.

## Ratchet result

All four standing blockers from `PR-94-delta.md` are closed. The exceptional repair
introduces one new harm-class blocker: Start now admits a genuinely active claim by
serving authored content in memory, but the same open session switches to the
generated cache body when that claim completes.

## Standing blocker status

### 1. CLOSED — onboarding and abandoned-claim Start wall

The repaired Start boundary checks whether a lesson is servable, not whether the
cache reports `ready`. `servableItemLesson` returns a completed cache body when one
exists and otherwise returns the authored Italian lesson in memory without a model
call, spend reservation, or cache write.

Built disposable onboarding sequence:

- matching build manifest → 200;
- `POST /api/onboarding` → 200;
- routed `/practice/session` → Start 200;
- lesson GET → 200;
- authored `Pronomi soggetto` visible;
- no error screen;
- `spend_ledger` → 0 rows;
- `item_lessons` → 0 rows.

Built abandoned-current-claim sequence:

- current item received an empty v2 claim;
- `/api/session` reported `preparing`;
- Start → 200;
- lesson GET → 200 with deterministic authored Italian;
- claim remained empty and owned by the abandoned token;
- `spend_ledger` → 0 rows.

The original wall is closed.

### 2. CLOSED — ambiguous timeout spend

A late-resolving client deliberately ignored `AbortSignal`. At the two-minute local
timeout, the pending reservation was committed once at its admitted upper bound
before authored fallback completed. Before and after the late resolution:

- exactly one ledger row existed;
- it was `committed`;
- its cost equalled the reserved upper bound;
- reopening the same item made no second call;
- no duplicate ledger row appeared;
- an attempted call for another item at the now-reached cap was refused before its
  client ran.

The hard cap and audit record remain conservative.

### 3. CLOSED — aggregate language test sensitivity

The new `DELTA_ALL_SHORT_ENGLISH` fixture consists entirely of one- and two-token
fields, so per-field acceptance cannot reject it. With current code it is rejected.
Mutating only the whole-lesson guard at
`lib/lessons/italian-language.ts:108-110` to false made exactly the named aggregate
test fail because the body was then accepted.

### 4. CLOSED — claim ownership test sensitivity

The changed test resolves the reclaimed former owner first while the successor row
is still empty. Current code rejects the stale completion and accepts the successor.
Removing only `AND claim_token = ?` from `completeItemLesson` made the named test
fail: the stale body filled the row. The ownership test now proves the token
predicate rather than relying on the empty-body predicate.

## New blocking finding

### BLOCKING — an active preparation can replace the lesson after Start

Locations:

- `app/api/session/start/route.ts:21-29`
- `lib/lessons/lesson-serving.ts:12-16`
- `app/api/session/lesson/route.ts:26-32`

The new Start gate cannot distinguish an abandoned claim from a healthy one. It
allows both because authored Italian is servable. `servableItemLesson` prefers the
cache whenever it later becomes non-empty.

Controlled route sequence on a vocabulary-only day:

1. The planner selected a `lemma:*` item.
2. A live owner claimed that item and remained unresolved.
3. Start returned 200.
4. The first lesson GET returned deterministic authored `rule:*` Italian.
5. The same live owner completed a valid generated vocabulary body.
6. The next lesson GET for the already-open session returned the `lemma:*` body.

The daily session's selected item and steps are frozen, but its actual lesson body
and taught item are not. The two new route tests do not catch this: onboarding has
no claim, while the abandoned claim never completes.

Harm: **silent wrong result / contract violation** — one frozen session can teach
an authored grammar substitution and then change on reload/reopen to a generated
vocabulary lesson. Its drills and the item receiving cued evidence can therefore
change after the learner has already seen the teaching step.

Assumption: a model preparation is genuinely in flight when the learner enters
`/practice/session` directly (for example from another tab or direct navigation)
and resolves after the first lesson read. Multi-tab preparation is a supported path.

Ratchet classification: **introduced by this exceptional repair**. Before this
commit, Start rejected every `preparing` state; the new servability check admits the
active claim without pinning the authored choice.

## Changed tests as specifications

- `tests/onboarding-first-session.test.ts` correctly specifies that direct onboarding
  starts and serves authored Italian with no cache or spend.
- `tests/abandoned-claim-start.test.ts` correctly specifies that an unresolved empty
  claim cannot wall model-free Start and is not overwritten.
- `tests/item-lessons-engine.test.ts` correctly specifies conservative timeout
  accounting before and after a late abort-ignoring resolution, no retry, and one
  cache body.
- `tests/italian-lesson-language.test.ts` now isolates the aggregate-only language
  risk and is mutation-sensitive.
- `tests/item-lessons-schema.test.ts` now orders stale completion before successor
  completion and is mutation-sensitive.
- `tests/session-routes.test.ts` correctly specifies immediate authored servability,
  but does not specify stability when an active claim completes after Start.

## Verification

- Read the complete exceptional repair diff and every touched file in full.
- Reviewed SHA matched the PR head.
- GitHub `gates` was green at the exact SHA.
- Focused repair suite passed: 6 files, 31 tests.
- Full suite passed: 163 files, 1521 passed, 3 skipped.
- `npm run lint` passed with the three pre-existing unused-import warnings in
  `lib/analysis/audio-model.ts`.
- `npm run typecheck` passed after the build generated a consistent `.next/types`;
  an earlier parallel build/typecheck invocation raced on that generated directory
  and was rerun serially.
- `npm run build` passed with the pre-existing dynamic-dependency warning from
  `lib/speaker/sherpa-embedder.ts`.
- `.mfactory/hooks/run-tripwires.sh --all` passed.
- Aggregate-only guard mutation: named language test failed.
- Claim-token predicate mutation: named ownership test failed.
- Independent timeout/cap probe passed.
- Independent active-claim route probe reproduced the new blocker.
- Built disposable server identity:
  - build `Y80KgI1QLJa0KFWNpvx6W`;
  - random port `52463`;
  - matching build manifest returned 200;
  - disposable database
    `/var/folders/h3/6g7s8fj91b18l5sl281mzryh0000gn/T/erika-pr94-final-built-DYK54l/erika.db`.

I tried hardest to break active-versus-abandoned claim handling, conservative
timeout accounting, the two repaired mutation tests, and built direct-session
behavior.
