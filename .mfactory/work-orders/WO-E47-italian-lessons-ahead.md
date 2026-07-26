# WO-E47 — Italian lessons, prepared before launch

Target repo: github.com/immaculatecross/erika · Branch: `feat/e47-italian-lessons-ahead` · **Review tier: Full**
Batch: **solo, serial.** This is the operator-directed first milestone of v0.8. It touches generated-content validity, the shared spend path, cache invalidation, and likely migration v31. The dispatcher, not the worker, performs the FEATURES.md/STATE.md completion ritual.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md`, `DECISIONS.md` (D-17, D-18, D-19, D-23, D-26, D-27), `HANDOVER.md`, `CLAUDE.md`, `DESIGN.md`, then `.mfactory/playbooks/task.md`.

## Objective

The learner never opens a lesson and waits for Erika to write it. Maintain a one-lesson-ahead invariant: once the daily composer has selected the next knowledge item, its complete lesson is prepared before the session can start, cached once, and opening the lesson performs no model call. If generation is impossible, the already-authored Italian syllabus lesson is the prepared lesson, so there is no wall.

Every piece of teaching content is in the target language, Italian: title, explanation, examples, vocabulary definitions, exercise cues, choices, answers, and rationales. The surrounding application chrome remains English; this milestone amends D-17 only for lesson content.

## Acceptance criteria

1. **The authored backbone is Italian.** All 266 syllabus rules ship with Italian titles and Italian explanations, not translations performed at runtime. Their examples remain correct Italian. A fresh, keyless database can receive a complete grammar lesson whose title, explanation, examples, exercises, and rationales are Italian. Tests assert the positive over all 266 rules: every rule has non-empty Italian teaching content and every rule can yield or substitute to a complete lesson.

2. **Generated content is Italian end to end.** Grammar and vocabulary prompts require Italian for every learner-visible field: `intro`, vocabulary definition/gloss, `newWords` definitions and examples, exercise `prompt`, `options`, `answer`, and `rationale`. Replace English-specific public shapes and names such as `glossEn`; do not retain an English field behind an Italian label. Meaning-first and D-18 still hold: prompts use an Italian definition or correct Italian context, never the learner's erroneous form.

3. **Italian is enforced, not merely requested.** No generated body enters `item_lessons` unless every learner-visible prose field passes a bounded, deterministic Italian-language validation. An all-English response and a materially mixed English/Italian response are rejected; a valid Italian response passes. One bounded repair may ask the model to correct the language. Failure falls back to authored Italian content and never shows English. Add fixtures for valid Italian, all-English, mixed-language, and short grammar tokens where a language detector could otherwise lie. State the validator's honest limits and mutation-prove that removing the rejection makes tests fail.

4. **Preparation happens before session launch.** Once today's item is known, preparation begins outside `/api/session/lesson`. The Learn home retains one primary action: while a billable preparation is genuinely in flight it may show one calm progress state, not another control; Start is enabled only when the lesson is prepared. Keyless, cap-blocked, rejected-key, network-failed, or invalid-model-output paths prepare the authored Italian fallback immediately and remain completable. There is no first-open generation path.

5. **Opening a lesson is read-only with respect to generation and spend.** Starting `/practice/session`, requesting `/api/session/lesson`, moving between lesson and drills, refreshing, and reopening make zero text-model calls and add zero spend rows. They read the prepared cache or the deterministic authored Italian lesson. Prove this at the route/user-flow boundary, not only by testing a helper.

6. **One-lesson-ahead is idempotent and cap-safe.** Repeated Learn-home reads and concurrent preparation attempts produce at most one resolved model call and one finalized ledger charge for an item. Existing reserve-before-call, hard monthly cap, parse-failure billing, lease/claim, and cache-hit-bills-zero invariants remain intact. A preparation failure cannot strand an empty claim or block tomorrow's lesson.

7. **Existing English caches cannot leak through.** Version the lesson content contract or add migration v31 so rows written under the English contract are never served. Deleting/replacing generated cache bodies is permitted; deleting knowledge items, evidence, reviews, progress, findings, or user recordings is forbidden. If there is a migration, update `docs/schema.md` in the same PR and prove migration idempotency.

8. **Vocabulary has an honest offline path.** Do not attempt to pre-generate all 30,786 lemmas. Prepare only the composer-selected rolling lesson. Because the shipped lexicon has no license-clean definitions, a vocabulary item that cannot be generated must substitute a complete authored Italian grammar lesson at the learner's CEFR edge rather than render an English gloss, an empty definition, or a refusal.

9. **The language boundary is visible in product tests.** Drive a disposable fresh database through Learn home → Start → lesson → drills for (a) keyless fallback and (b) one bounded real generated lesson if the operator key is available. Assert the rendered teaching content is Italian and that launching/reopening adds no spend. Bind a random port and prove which built server answered. Never touch `data/erika.db`.

10. **Record the product decision.** Add a new decision amending D-17: Erika's global chrome may remain English, but lesson teaching content is target-language-only; lessons are prepared before launch. Add E-47 to the v0.8 scope as the operator-directed first milestone. Do not mark it done or regenerate `STATE.md`; the dispatcher performs the completion ritual after merge.

## Files and constraints

Centre of gravity:

- `lib/syllabus/grammar-it.json`, `lib/syllabus/**`
- `lib/lessons/lesson-parse.ts`, `lib/lessons/item-lessons*.ts`, `lib/lessons/syllabus-lesson.ts`
- `lib/session/**`, `app/api/session/lesson/route.ts`, Learn-home/session components
- the preparation trigger/worker seam chosen by the implementation
- `lib/migrations/**` and `docs/schema.md` if cache versioning needs v31
- tests covering generated parsing, preparation concurrency/spend, route behavior, and the built flow

Binding constraints: D-18 correction-forward/error-once; D-19 append-only evidence and validated knowledge ids; D-23 register dial; D-26 one calm linear session; D-27 syllabus backbone; E-17 findings gate untouched; one spend spine; reserve before call; hard cap; resolved calls ledgered even when output is rejected; source files under 500 lines; Conventional Commits; disposable database only.

The operator has an unrelated local fix in `components/session/drills-step.tsx` in the parent checkout. Work in an isolated worktree from `origin/master`; do not overwrite, stage, or claim that local edit. If this milestone genuinely needs the same file, make the product change in your branch and call out the overlap for the dispatcher.

## Out of scope

- Translating navigation, Settings, system notices, onboarding, Record, progress, or other global chrome.
- Translating the tutor, analysis explanations, cards, letters, readings, or non-lesson Library surfaces.
- Pre-generating the entire lexicon or all possible personalized lessons.
- E-39 debt work, hosting, native iOS, or the unrelated local drill completion fix.
- Weakening the budget cap, generating during a GET, or making session completion depend on network access.

## Gates that will not tell you the truth locally

- Run `.mfactory/hooks/run-tripwires.sh --all` before opening the PR. The pre-commit hook only scans staged files.
- `npm run lint` must actually inspect files. If it passes suspiciously fast or produces no meaningful output, verify with `npx eslint . --ext .ts,.tsx`.
- Run gates sequentially where `.next/types` is involved. A concurrent `npm run build` and `npm run typecheck` can race because the build rewrites `.next`; the baseline exhibited this exact false red and passed when rerun after build.

## Verification

Required: focused tests with mutation proof, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `.mfactory/hooks/run-tripwires.sh --all`, and the disposable built-app walkthrough in criterion 9.

The one real model call is authorized only against a disposable database and the existing monthly cap. Record model, measured ledger cost, and outcome without printing the API key or payloads containing secrets. If no key is available, report that keyed verification as operator-gated; do not fake it.

**Branch and push first:** create the isolated worktree, create `feat/e47-italian-lessons-ahead` from `origin/master`, make an empty Conventional Commit, and `git push -u origin feat/e47-italian-lessons-ahead` before implementation. Write the exit report below before returning so it survives a lost completion signal.

## Exit report

Append:

`RESULT / PR / Changed / Verified / Tests changed or removed / Risks / Blocker`

Also include: the exact one-lesson-ahead trigger and state transitions; every learner-visible lesson field and its language guarantee; cache invalidation behavior; money/concurrency proof; language-validator mutation proof; the built-server identity proof; and any overlap with `components/session/drills-step.tsx`.

### Worker exit — 2026-07-26

RESULT: done
PR: https://github.com/immaculatecross/erika/pull/94

Changed:
- Curated all 266 shipped syllabus rules into Italian titles and explanations, kept Italian examples, and made every authored rule yield or substitute to a complete Italian lesson.
- Replaced the public English `glossEn`/`gloss` lesson shape with Italian `definition` fields. Generated `intro`, `definition`, lesson examples, new-word lemma/definition/example, exercise prompt/definition/options/answer/rationale all pass `assertItalianLesson` before persistence; titles come from the Italian syllabus or the Italian lemma.
- Added a bounded deterministic language gate that rejects explicit English and materially mixed prose, documents its honest one-to-five-token limit, and permits one Italian-only repair before authored fallback.
- Exact one-ahead trigger: `/practice` reads `lessonPreparation`; `needed` causes one `POST /api/session/prepare`, the UI exposes only the calm `preparing` state, and a concurrent loser/persisted claim remains `preparing` and polls until `ready`. The winner claims before spend, then stores generated Italian or immediately fills the claim with authored Italian for no key, cap refusal, rejected key, network/parse/language failure. `/api/session/start` returns 409 until `ready`.
- `GET /api/session/lesson`, session launch/reload, lesson→drills movement, and the legacy item-lesson read make no model call. Vocabulary without a generated definition caches a complete authored grammar lesson at the current placement edge; evidence is attributed to the rule actually served.
- Migration v31 adds `item_lessons.content_version`, deletes only disposable v1 lesson cache rows, and readers accept only contract v2. Knowledge, evidence, reviews, findings, progress, recordings and spend remain untouched.
- Recorded D-29 and added building E-47 as the operator-directed first v0.8 milestone without changing STATE or marking it done.

Verified:
- `npm run lint` ✓ (real file inspection; only the three pre-existing `lib/analysis/audio-model.ts` unused-import warnings).
- `npm run typecheck` ✓, including a sequential rerun after build.
- `npm test` ✓ — 160 files, 1511 passed, 3 skipped.
- `npm run build` ✓.
- `.mfactory/hooks/run-tripwires.sh --all` ✓.
- Focused Italian/syllabus/preparation/session tests ✓; all 266 rules and their examples pass the positive Italian/content checks.
- Money/concurrency proof: concurrent preparation tests resolve one provider call and one committed charge; cache hits add zero; hard-cap refusal calls zero times; each resolved failed/repair call is ledgered; every failure fills rather than strands the claim; stale empty claims are swept without touching complete bodies.
- Language mutation proof: temporarily disabling the rejection in `assertItalianLesson` made `tests/item-lessons-engine.test.ts -t "uses one bounded language repair"` fail because only one call occurred instead of the required repair; restoring it made the focused suite green.
- Built-app proof: production build `v4pFTdEt3JBC2vP0mI4W4`, random port `63986`, disposable `/tmp/erika-e47-built.EddtNq/erika.db`; its exact `/_next/static/<BUILD_ID>/_buildManifest.js` returned 200. Headless Chromium drove Learn home → Start → rendered Italian lesson → rendered Italian drill → reload at drills. Spend rows stayed 0 and exactly one completed v2 cache body existed.

Tests changed/removed:
- Added `tests/italian-lesson-language.test.ts` for valid Italian, all-English, materially mixed, and short grammar-token fixtures.
- Updated `tests/item-lessons-engine.test.ts` for Italian fixtures, bounded repair, concurrent preparation, cap/key/network/parse fallbacks, and stale claims.
- Updated `tests/item-lessons-parse.test.ts`, `tests/lesson-budget.test.ts`, and `tests/lesson-truncation.test.ts` for the Italian `definition` contract and repair behavior.
- Updated `tests/item-lessons-schema.test.ts` and `tests/migrations.test.ts` for content version v2 and migration v31 invalidation/idempotency.
- Updated `tests/lesson-syllabus-first.test.ts` to positively check all 266 titles, descriptions and examples and the offline vocabulary substitution.
- Updated `tests/learn-today-render.test.tsx`, `tests/lesson-runner-render.test.tsx`, and `tests/session-routes.test.ts` for the preparation state, rendered Italian teaching fields, Start/read/reopen/step zero-spend flow.
- No tests removed.

Risks:
- Live keyed generation was operator-gated because this isolated worktree had no API key. Provider behavior is covered with deterministic clients, including resolved billing and every specified fallback, but model quality/cost was not measured live.
- `components/session/drills-step.tsx` overlaps the operator's unrelated uncommitted parent-checkout edit. This branch did not copy or stage that edit; its own four-line change is required so vocabulary substitution writes evidence to `lesson.lesson.itemId` (the rule actually taught), not the originally selected lemma.

### Worker repair exit — 2026-07-26

RESULT: done — all four BLOCKING findings and the advisory were repaired in the one allowed cycle.
PR: https://github.com/immaculatecross/erika/pull/94
HEAD: `905dad2e4b66acdbf28c5f3c297c9bd482f111e0`

Changed:
- Replaced the language word lists with deterministic `tinyld` field classification plus a complete-body Italian/English backstop. The exact reviewed English lesson (`Modal verbs need careful study`, `People speak clearly`, both `Find…` prompts, modal choices/answers, and English rationales) is rejected, while `Mario guarda Luca mentre corre veloce` passes. One- and two-token homographs remain the stated honest limit and are protected by the body-level gate.
- The actual planner now retains a composed vocabulary item when no rule exists even with no key or remaining budget. The real session/prepare/lesson/start routes turn `newVocabPerDay: 1`, rules/pronunciation 0 into a cached authored grammar lesson at the learner edge, with lesson and drills present and zero spend.
- Migration v31 also adds `claim_token`. Claim completion/release requires ownership, so a reclaimed stale worker cannot overwrite or delete its successor. Text requests now abort and settle after two minutes, below the 15-minute stale threshold. A held first call therefore falls back before sweeping, and a second preparation reads the cache: one provider attempt, zero unresolved-call ledger rows, no duplicate charge.
- Corrected `richiedono`, taught `perché` as normally posposed with matching example, and restored `stringe`. The focused same-class sweep also repaired literal connective explanations, irregular-plural prose, the English term `gapping`, truncated/literary examples, and classifier-hostile slash fragments. Ground-truth assertions pin these judgments without calling the language validator.
- Fixed the advisory: full Italian definitions now use 15px body typography rather than uppercase caption styling.

Verified:
- Mutation proof (language): disabling `assertItalianLesson` rejection made 4/6 tests fail, including the exact reviewer fixture; restored test passes.
- Mutation proof (planner): returning `null` for the vocabulary selection made `tests/vocabulary-offline-session.test.ts` fail at the route boundary; restored test passes.
- Mutation proof (money): moving the model timeout beyond the stale threshold made the deterministic held-first-call test time out; restored test passes.
- Focused repair suite: `npx vitest run tests/italian-lesson-language.test.ts tests/lesson-syllabus-first.test.ts tests/item-lessons-engine.test.ts tests/item-lessons-schema.test.ts tests/vocabulary-offline-session.test.ts tests/session-plan.test.ts tests/lesson-runner-render.test.tsx tests/migrations.test.ts tests/onboarding-day-one.test.ts` — 9 files, 84 passed.
- Sequential release gates: `npm run lint` ✓ (only three pre-existing audio-model warnings); `npm run typecheck` ✓; `npm run test` ✓ (161 files, 1518 passed, 3 skipped); `npm run build` ✓; `.mfactory/hooks/run-tripwires.sh --all` ✓.
- GitHub CI `gates` ✓ at repaired head (3m35s).

Tests changed/removed:
- Added `tests/vocabulary-offline-session.test.ts`; expanded language, item-lesson engine/schema, syllabus ground-truth, migration, planner, and render tests. No tests removed.

Risks:
- Very short words are linguistically ambiguous (`so` is valid in both Italian and English), so one- and two-token fields are accepted individually; the whole lesson must still classify as Italian over English, and the reviewed all-short-field English body is rejected.
- The real OpenAI client honors the abort signal. The caller also races every client against the bound, but a non-production client that ignores abort could continue work after the caller settles; it cannot overwrite the owned cache row or cause a second application-side attempt before fallback is cached.
- No additional paid call was made in the repair cycle. The full reviewer had already verified one live keyed generation at the pre-repair head; all changed money/timeout behavior is covered deterministically.
- The parent checkout was not staged or otherwise touched except for this required append-only report. The branch's existing `drills-step.tsx` diff remains limited to served-item evidence attribution.

Blocker: none.

### Worker exceptional repair exit — 2026-07-26

RESULT: done — operator-authorized exceptional second repair closed all four delta BLOCKING findings in one focused commit.
PR: https://github.com/immaculatecross/erika/pull/94
HEAD: `bf4eb22be3d426f80082c3268439383727c6cbfd`

Changed:
- Added one read-only `servableItemLesson` contract shared by Start and lesson GET. A completed v2 cache wins; otherwise the complete authored Italian backbone (including vocabulary's grammar substitution) is served in memory. Start no longer equates an empty/preparing claim row with an unavailable lesson.
- Fresh onboarding can continue directly to `/practice/session` and open immediately. A current abandoned empty claim may still report `preparing`, but Start and lesson GET proceed with authored Italian. Neither path calls a model, writes a lesson cache body, or adds spend.
- A 120-second model timeout is now treated as an ambiguous accepted-call outcome. The already-admitted reservation is finalized once at its conservative upper bound before authored fallback; definite non-timeout failures still release. A late abort-ignoring completion has no second observer and creates no duplicate row.
- Added the exact aggregate-only short English fixture and reordered the claim test so the stale former owner attempts completion while the successor row is still empty.

Focused mutation commands/results:
- Aggregate guard mutation: changed only `if (whole.italian === 0 || whole.italian <= whole.english)` to `if (false && (...))`, then ran `npx vitest run tests/italian-lesson-language.test.ts -t "aggregate-only all-English lesson"` → expected FAIL, 1 failed / 6 skipped (`expected function to throw an error, but it didn't`). Restored guard → focused suite PASS.
- Claim ownership mutation: changed only the ownership condition `AND claim_token = ?` to the non-owning bound predicate `AND ? IS NOT NULL`, then ran `npx vitest run tests/item-lessons-schema.test.ts -t "former owner from overwriting"` → expected FAIL, 1 failed / 2 skipped (stale-first completion returned a lesson instead of null). Restored predicate → focused suite PASS.

Verified:
- Focused restored command: `npx vitest run tests/italian-lesson-language.test.ts tests/item-lessons-schema.test.ts tests/item-lessons-engine.test.ts tests/onboarding-first-session.test.ts tests/abandoned-claim-start.test.ts tests/session-routes.test.ts` → 6 files, 31 passed.
- Sequential gates: `npm run lint` ✓ (three pre-existing `audio-model.ts` warnings); `npm run typecheck` ✓; `npm run test` ✓ (163 files, 1521 passed, 3 skipped); `npm run build` ✓ (pre-existing sherpa dynamic-dependency warning); `.mfactory/hooks/run-tripwires.sh --all` ✓.
- GitHub CI `gates` ✓ at exceptional repaired head (3m59s).
- Built-server identity: production build `G8LsFJ30RyVCtQ2lt9ov4`, random port `52122`, disposable DB `/tmp/erika-e47-exceptional.suh2yi/erika.db`; matching `/_next/static/G8LsFJ30RyVCtQ2lt9ov4/_buildManifest.js` returned 200.
- Built onboarding proof: `POST /api/onboarding` returned complete; direct `POST /api/session/start` returned `started=true, step=lesson`; lesson GET served deterministic authored `rule:subject-pronouns`; spend rows 0 and cache rows 0.
- Built abandoned-claim proof: after inserting a current empty v2 claim, session GET reported `preparing`; Start returned `started=true, step=lesson`; lesson GET served deterministic authored `rule:subject-pronouns`; spend rows remained 0 and the claim body remained empty.
- Timeout proof: deterministic client ignored abort and resolved after timeout; before and after late resolution there was exactly one committed row at the reserved upper bound, one provider attempt, one authored cache result, and no retry charge.

Tests changed/removed:
- Added `tests/onboarding-first-session.test.ts` and `tests/abandoned-claim-start.test.ts`.
- Corrected the old `session-routes` 409 specification; expanded language, engine, and stale-ownership tests. No tests removed.

Remaining risks:
- Ambiguous timeout accounting intentionally prefers over-recording: the ledger may retain the reserved upper bound when the provider ultimately charged less or nothing. This can refuse later work early, but cannot understate accepted-call spend or weaken the hard cap.
- The parent checkout was not staged or otherwise modified except for this required append-only report. The branch's pre-existing `drills-step.tsx` change remains limited to served-item evidence attribution.

Blocker: none.

### Worker final stability repair exit — 2026-07-26

RESULT: done — closed the final-review active-claim session-stability blocker without reopening money, language, onboarding, or abandoned-claim guarantees.
PR: https://github.com/immaculatecross/erika/pull/94
HEAD: `a9e840aa734344638f21e5f86bb5662577616364`

Changed:
- Added `pinServableItemLesson`: on Start, if the composer-selected item has no completed v2 body, atomically fill the empty/off-version claim with the complete authored Italian lesson (including vocabulary→grammar substitution), clear `claim_token`, and freeze that body as the open session's lesson.
- `/api/session/start` now pins instead of only reading `servableItemLesson`. Lesson GET remains read-only and therefore returns the same pinned cache after Start.
- A late active owner may still finalize its accepted-call spend exactly once; `completeItemLesson` cannot replace the non-empty pinned body or a cleared token, so lesson GET, drills, and cued-evidence target stay frozen on the served rule.
- Documented Start pinning in `docs/schema.md`.
- Updated onboarding and abandoned-claim route tests for the pinned non-empty body.
- Added `tests/active-claim-session-stability.test.ts` at the product boundary (vocab-only day, live unresolved claim, Start, lesson GET identity, late owner resolution, evidence, one committed spend).
- Added store-level ordering proof: pin then late owner complete cannot overwrite.

Focused mutation commands/results:
- Start pin mutation: temporarily replaced `pinServableItemLesson` with `servableItemLesson` in `app/api/session/start/route.ts`, then ran `npx vitest run tests/active-claim-session-stability.test.ts` → expected FAIL (`expected 0 to be greater than 0` on the pre-owner pin body). Restored → PASS.
- Pin-write mutation: temporarily made `pinServableItemLesson` return `servableItemLesson` with no cache write, then ran `npx vitest run tests/item-lessons-schema.test.ts -t "keeps a Start pin"` → expected FAIL (late `completeItemLesson` wrote the generated vocab body). Restored → PASS.

Verified:
- Focused: `npx vitest run tests/active-claim-session-stability.test.ts tests/item-lessons-schema.test.ts tests/abandoned-claim-start.test.ts tests/onboarding-first-session.test.ts tests/vocabulary-offline-session.test.ts tests/session-routes.test.ts` → PASS.
- Sequential gates: `npm run lint` ✓ (three pre-existing `audio-model.ts` unused-import warnings); `npm run typecheck` ✓; `npm run test` ✓ (164 files, 1523 passed, 3 skipped); `npm run build` ✓ (pre-existing sherpa dynamic-dependency warning); post-build `npm run typecheck` ✓; `.mfactory/hooks/run-tripwires.sh --all` ✓.
- Pushed normally to `origin/feat/e47-italian-lessons-ahead`; PR #94 head is this SHA.

Tests changed/removed:
- Added `tests/active-claim-session-stability.test.ts`.
- Expanded `tests/item-lessons-schema.test.ts` with the Start-pin late-owner store proof.
- Updated `tests/onboarding-first-session.test.ts` and `tests/abandoned-claim-start.test.ts` to expect the pinned non-empty body instead of an empty/absent claim. No tests removed.

Remaining risks:
- A preparation that completes *before* Start finishes still wins and becomes the pin; that is intentional and leaves the session stable on generated content when it was ready in time.
- Ambiguous timeout upper-bound accounting from the exceptional repair is unchanged.
- Parent checkout `components/session/drills-step.tsx` was never touched. This worktree only used the isolated `Erika-e47-worker` path.
- No additional live keyed model call was made in this stability cycle.

Blocker: none.
