# PR #94 Full review

- PR: https://github.com/immaculatecross/erika/pull/94
- Reviewed SHA: `94d90acd35c35302ee92d31b786aeb2deed35c52`
- Review tier: Full
- Verdict: **REQUEST CHANGES**
- Native GitHub review: https://github.com/immaculatecross/erika/pull/94#pullrequestreview-4781800918
- GitHub state: `COMMENTED` because GitHub rejected a request-changes review from the PR author identity; the body explicitly records `REQUEST CHANGES`.

## Findings

### 1. BLOCKING — The language gate accepts a complete all-English model lesson and rejects valid Italian

`lib/lessons/italian-language.ts:80-101` accepts every one-to-five-token field unless it contains one of a small set of English words, and `assertItalianLesson` evaluates fields independently. A full grammar response with intro `Modal verbs need careful study`, example `People speak clearly`, prompts `Find matching form` / `Find suitable phrase`, options `can/could` and `might/must`, and rationales `Can shows possibility` / `Might shows uncertainty` passed `parseItemLessonResponse` as a two-exercise lesson. The inverse also fails: the valid six-token Italian sentence `Mario guarda Luca mentre corre veloce` is rejected as `no-italian-signal`.

The committed all-English fixture does not falsify this risk because it uses a long sentence containing several entries from `ENGLISH_WORDS`; the short-token tests exercise only three hand-picked English words.

Harm: **silent wrong result and happy path broken** — an all-English generated body can be cached and shown as successful Italian teaching, while valid generated Italian can be discarded and billed before fallback.

Assumption: the provider uses short English wording outside the small denylist, or valid Italian wording without one of the whitelist/suffix signals; both are ordinary model outputs, not malformed inputs.

### 2. BLOCKING — The actual planner suppresses the promised offline vocabulary substitution

`lib/session/plan.ts:91-102` returns a vocabulary item only when a cache already exists or the text model is reachable. That prevents the one-ahead preparation seam from ever receiving the exact keyless/cap-blocked vocabulary item for which `authoredLessonFor` implements grammar substitution.

On a fresh keyless database with the valid user settings `newVocabPerDay: 1`, `newRulesPerDay: 0`, and `newPronPerDay: 0`, the composer selected `lemma:e#CCONJ`; `planSession` returned `lessonItemId: null`, no steps, and omitted the lesson as `nothing-to-teach`. The direct `prepareItemLesson` vocabulary test therefore proves an unreachable helper path, not the daily product behavior.

Harm: **contract violation / happy path broken** — a legitimate vocabulary-only day has no session instead of the complete authored Italian grammar lesson required by criterion 8.

Assumption: a day has vocabulary but no grammar candidate, which is reachable through the shipped per-kind settings and also when grammar candidates are exhausted or ineligible.

### 3. BLOCKING — A live claim can be reclaimed and billed twice

`lib/lessons/item-lessons.ts:276-287` deletes an empty claim after 15 minutes, but the real request in `lib/lessons/text-model.ts:101-113` has no timeout or abort signal, and `completeItemLesson` at `lib/lessons/item-lessons.ts:156-174` has neither a claim token nor a `body = ''` ownership condition.

An independent controlled probe held the first model completion open, aged its claim past the sweep boundary, swept it, then started a second preparation. Both calls resolved and the ledger contained two committed charges. The stale first worker can also overwrite the second worker's completed body.

Harm: **contract violation / silent wrong result** — the at-most-one-call/one-charge guarantee fails, real spend is duplicated, and an older result can replace the retry's result while both requests report success.

Assumption: a provider request remains unresolved for 15 minutes while a Learn-home/session read runs; the production fetch has no bound that makes the code's “one call (seconds)” assumption true.

### 4. BLOCKING — The authored “Italian” backbone contains malformed and false teaching content

The all-266 test applies the same weak token detector rather than validating the authored judgment it claims. Concrete learner-visible defects include:

- `lib/syllabus/grammar-it.json:141`: the independent assertion ends in `richiedano il congiuntivo`, where standard Italian requires indicative `richiedono`.
- `lib/syllabus/grammar-it.json:174`: it labels `perché` as a preposed-cause connector while its own example places the causal clause after the main clause.
- `lib/syllabus/grammar-it.json:271`: it ships the malformed proverb `Chi troppo vuole nulla string`, truncating Italian `stringe`.

These strings are served by the deterministic success path and pass the committed positive test.

Harm: **silent wrong result** — a language-learning lesson teaches malformed Italian and incorrect grammar as authoritative authored content.

Assumption: one of these syllabus rules is selected directly or as a same-band substitute; the daily syllabus progression is designed to make that happen.

### 5. ADVISORY — Full definitions are styled as uppercase captions

`components/drill-card.tsx:81` renders the Italian `definition` itself with the 13px uppercase caption token. `DESIGN.md:20` defines that token as caption typography, and `DESIGN.md:46` clarifies that uppercase captions are section labels. This was less conspicuous for a short gloss, but the new public contract permits sentence-length definitions. It is a readability/design-token mismatch, not a demonstrated functional failure.

## Verification

- Read the complete PR diff and every touched file at the reviewed SHA.
- `npm run lint` passed with the three pre-existing unused-import warnings in `lib/analysis/audio-model.ts`.
- `npm run typecheck` passed before and after the build.
- `npm run test` passed: 160 files, 1511 passed, 3 skipped.
- `npm run build` passed; it retained the existing dynamic-dependency warning from `lib/speaker/sherpa-embedder.ts`.
- `.mfactory/hooks/run-tripwires.sh --all` passed.
- GitHub `gates` check passed.
- Live keyed production preparation, disposable database: `gpt-4.1-mini`, state `ready`, generated source, one committed call, measured ledger cost `$0.0010724`, zero pending rows, and the returned lesson passed the language gate. The API key was not printed.
- Built keyless walkthrough, disposable database: build `TKUnWK0Rbhuu1XwmgzmKN`, random port `65418`, matching build manifest returned 200; Learn home prepared authored Italian, Start opened the lesson, lesson-to-drills and reload/reopen preserved the drill, spend stayed at zero rows, and one non-empty v2 cache body existed.
- Built concurrency probe confirmed the intended polling path does converge: a second tab seeing `preparing` issued no preparation POST, observed an externally completed claim, and exposed Start without refresh.
- Verified by code and route behavior that Start and lesson GET are model-free, v31 deletes only disposable `item_lessons` rows under the transactional migration ledger, and substitution evidence uses the served lesson item id.

I tried hardest to break generated-language acceptance, authored Italian quality, keyless vocabulary planning, stale-claim money safety, migration/cache isolation, model-free launch, refresh/concurrency behavior, and served-item evidence attribution.
