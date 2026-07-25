# WO-E45 — The lesson and the deck

Target repo: github.com/immaculatecross/erika · Branch: `feat/e45-lesson-and-deck` · **Review tier: Full**
Batch: **solo, serial.** Depends on WO-E44 (merged): you fill the session container it built, and on WO-E43 (merged) for the STT seam voice answers use. Carries **no migration** unless criterion 3 forces one; if it does, it is **v31**. The **dispatcher**, not you, performs the FEATURES.md/STATE.md ritual.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md` (row E-45), `DECISIONS.md` (**D-26**, **D-18** and **D-19** are load-bearing here; also D-22, D-23), `HANDOVER.md`, `CLAUDE.md`, `DESIGN.md`, then `.mfactory/playbooks/task.md`.

## Objective

Three things about the teaching are wrong, and the operator named all three.

**One:** there are two disjoint lesson systems. Pattern lessons (`lib/lessons/lessons-view.ts`, `components/lesson-runner.tsx`) do multiple-choice, typed fill-in, and a **rewrite graded by a billed model call**. Item lessons (`lib/lessons/item-lessons-view.ts`, `components/item-lesson-runner.tsx`) do multiple-choice and cloze, graded locally. Two runners, two vocabularies of exercise, one learner. *"You have several different types of lessons… the keyword here is simplify."*

**Two:** exercises want typing, and shouldn't. *"Exercises should be either click or voice input."*

**Three, and worst:** flashcards show the learner a card whose prompt face is the literal word **grammar**. This is not occasional. `lib/cards-view.ts:120` returns `` `${CLOZE_BLANK} · ${category}` `` whenever the correction shares no leading *or* trailing token with the quote, or the correction is a pure deletion — which is **every single-word fix** (`"gatto" → "gatta"`) and **every whole-sentence rewrite** (the normal shape of `phrasing` and `idiom`). `components/flashcard.tsx:117-126` then renders the category label *above* it, so the learner reads `GRAMMAR` over `____ · grammar` and is asked to recall something unrecallable. The operator's principle: *"you should not assume that the user remembers all the mistakes they made — those flashcards can be inspired from all the learnings that you get from the recordings, but it shouldn't be, like, necessarily exactly the same thing."*

## Acceptance criteria

1. **One lesson format.** The two systems become one, with one runner and one exercise vocabulary. A day's lesson is a grammar or conjugation rule explained in plain English with three or four worked Italian examples at the D-23 register, **or** about ten new words with glosses, **or** a small mix — and it is sized to **five minutes or less of real reading**. Enforce that with a stated content budget (word count and item count, named as constants with the reasoning), and test that generated lessons respect it. Assert the *positive*: a lesson exists and fits — "no oversized lesson" is satisfied by no lesson at all.
2. **Click or voice only.** Typed `fill_in` and the model-graded `rewrite` leave the daily flow, and `lib/lessons/grade.ts`'s billed grading call with them. A spoken answer is captured, transcribed through the **E-43 `SpeechToText` seam**, and graded **deterministically** — normalized comparison against the target with a stated tolerance — never by a billed model call. State the normalization rules (case, accents, punctuation, elision, whitespace) as testable units, and say honestly what a learner experiences when STT mishears them: there must be a way to be right that does not depend on a perfect transcript.
3. **No card front is ever a bare category word.** State the invariant first: *every card front is answerable by a learner who has never seen the finding it came from* — because that is every learner. Then enumerate every path into `deriveFront` and prove none violates it. Permitted front shapes: an English gloss to produce in Italian, a meaning-first Italian context gap with enough context to disambiguate, or a "how would you say…" prompt. Cards may be **inspired by** the finding rather than quoting it (operator's explicit permission) — D-18 is unaffected either way, since the learner's error is still never the stimulus. Where a model genuinely produces a better front, generate it **at card-mint time**, cached and ledgered like every other biller (reserve-before-call, cap-hard, re-open bills zero) — and it **must** degrade without a key to a deterministic answerable front, **never** to `____ · grammar`. Prove totality with a property test over synthetic findings covering all five categories and, specifically, the two failing shapes: pure deletions and corrections sharing no leading or trailing token.
4. **The duplicated category label goes.** `components/flashcard.tsx` renders `CategoryLabel` directly above the front; with a degraded front the learner sees the category twice. Remove the duplication (`app/practice/cards/page.tsx:143` renders the same front — check it too).
5. **A bystander's mistakes never become the learner's.** This is the half of E-36 that was never wired and it is an accuracy defect, not a privacy nicety. `lib/findings-model.ts` — the single gate every read site goes through (E-17, CLAUDE.md) — has **no speaker predicate**, while `is_user` is read in two other places under two different rules. Add the predicate there, so a finding on a segment that is **confidently not the user** never becomes a card, slip, drill, lesson input or focus statistic. **D-22 recall-first is absolute: `is_user IS NULL` means unattributed and is treated as the learner** — attribution must never silence an un-enrolled learner. Enumerate every consumer in the PR body and reconcile the two divergent read sites into one rule (this repo has produced two defects from "one rule, two dialects" already).
6. **`pinFinding` goes through the gate.** It reads `findings` raw with no inclusion gate, violating CLAUDE.md's own E-17 rule and falsifying `lib/findings-model.ts`'s own comment about itself.

## What this milestone deletes

Your PR body carries a **"What this deletes"** section. Expected: one of the two lesson runners and its exercise vocabulary, the typed `fill_in` and `rewrite` types, the billed rewrite-grading call, the `` `____ · ${category}` `` degradation, and the duplicated category label. If concepts go up on net, justify it.

## Files and constraints

Centre of gravity: `lib/lessons/**` (unified), `components/lesson-runner.tsx` + `components/item-lesson-runner.tsx` (one survives), `lib/cards.ts`, `lib/cards-view.ts`, `components/flashcard.tsx`, `app/practice/cards/page.tsx`, `lib/findings-model.ts`, `lib/phrasebook.ts`, `app/api/lessons/**`.

Must not break: **D-18** — no lesson, exercise or card ever shows an erroneous form as a stimulus, and the original appears exactly once, at feedback time, subordinate and marked; **D-19** — a completed exercise writes exactly one **cued** evidence row through the `lib/knowledge/` door on a morph-it-validated lemma or a seeded rule id, and cued/recognition never mint `known`; **E-17** — one findings truth; append-only `evidence` and its v14 triggers; reserve-before-call and the hard cap; `UNCARDABLE_CATEGORIES` (a pronunciation finding still routes to the studio, never to a card).

Repo rules: Conventional Commits (subject ≤72 chars), 500 lines per file, never edit a shipped migration, never commit `data/` or `.env*`, disposable database only.

## Out of scope

The session container and what completes a day (WO-E44, merged); the tutor loop (WO-E43, merged — you *use* its STT seam, you do not modify it); onboarding and progress (WO-E46); the Record tab (WO-E42, merged); Azure pronunciation scoring (D-21, untouched); `FEATURES.md`/`STATE.md`.

## Verification

Drive the built app on a fresh disposable database and actually **do a lesson and a deck of cards in a browser**, keyless and keyed — reading the diff will not tell you whether a card is answerable. Seed a corpus that contains the two known-bad finding shapes and confirm no front degrades. **Prove which server answered you** and state the proof. Mutation-prove every new guard, especially the speaker predicate (delete the `IS NULL` clause and show a test go red — if nothing goes red, the recall-first rule is unasserted, which is exactly how D-19's `known` gate ended up with two deletable clauses). Expectations come from the fixture, never from the artifact under test.

Gates green plus tripwires. **Branch and push first**: empty commit and `git push -u origin feat/e45-lesson-and-deck` as your very first action.

## Exit report

Append here and **write it before returning**. Include the criterion-by-criterion status, the "What this deletes" list, the full enumeration of `deriveFront` paths with the proof of totality, the enumeration of every findings-model consumer affected by the speaker predicate, the mutation proofs, and the proof of which server answered.

---

## Amendment 1 — 2026-07-25, from the Full review of PR #66 (merged)

7. **The blurred final vowel is instructed into two classes at once, and the collision mints exactly the card the operator complained about.** `lib/mistakes.ts` places it in class A (grammar — **cardable**) and class C (pronunciation — **uncardable**). The reviewer drove a real cascade and got a card whose front is `"____ · grammar"` and whose *answer is the word the learner already said*. Criterion 3's totality proof must include this case explicitly as a named test: a finding that is simultaneously a plausible grammar agreement error and a pronunciation artifact must resolve to **one** class deterministically, and whichever way it resolves, no unanswerable front may result. Decide and document the tie-break rule; do not leave it to whichever branch runs first.

---

## Standing clause — product authority (operator directive, 2026-07-25)

Operator, on approving the v0.7 plan: *"aim for a really complete, usable, intuitive consumer product. Each one of those can have solutions — really make product calls, after thinking well and justifying them a little bit."*

**So the bar is not "the acceptance criteria are satisfied." The bar is that a person who has never seen this repository can use the thing end to end, without asking a question, and want to come back tomorrow.** If a criterion is ticked and that sentence is still false, the milestone is not done.

**You have product authority inside this milestone's scope, and you are expected to use it.** Choose the interaction. Choose the copy. Add the affordance the flow obviously needs and the work order failed to name. Resolve the ambiguities it left. Do not ship something technically correct but half-usable because the brief did not mention the missing half — a work order is the dispatcher's best guess at the product, written without having built it, and it is not scripture.

**The price of that authority is a short written justification.** In the PR body, a section that names each real product call: what you chose, what you rejected, and why. Two or three sentences each. If a call you want to make **contradicts an acceptance criterion**, that is allowed — say so explicitly, make the case, and implement your call; what is not allowed is silently narrowing the milestone, or leaving a criterion unmet without saying that you did.

**What is not yours to move**, because it is settled and re-litigating it wastes the run: the binding decisions — `DESIGN.md` in full, D-18 (correction-forward, error-once), D-19 (the knowledge model and the `known` gate), D-22 (speaker filtering local and recall-first), D-23 (register), D-24 (the calm habit layer and its ban list), E-17 (one findings truth), the money spine (reserve-before-call, the hard cap, spend recorded when a call resolves), and the rule that a shipped migration is never edited. Also not yours: **another milestone's scope.** A product call that belongs to a later milestone is a note in your exit report, not a diff — the dispatcher will route it.

**And subtraction still wins ties.** D-26 exists because this product acquired too many concepts, not too few. When two designs are close, ship the one with fewer things on screen.

---

## Amendment 2 — 2026-07-25 · D-27 and D-28

**D-27 — the lesson's content comes from the syllabus first.** Criterion 1's "a rule, or about ten words, or a small mix" is now drawn primarily from E-26's lexicon and grammar syllabus at the learner's knowledge edge, with findings and slips **woven in when present**. A learner with no recordings still gets a complete lesson; that is the primary path and must be tested on an empty database. See WO-E44 Amendment 1.

**D-28 — where STT is and is not allowed.** Criterion 2's voice-answered drills are explicitly **permitted** to use speech-to-text, because a drill has a **known correct answer** and is therefore scripted assessment (D-21's standing allowance), not free-spoken error detection. What you must not do is let that STT path leak into anything that judges the learner's *spontaneous* speech — D-3 and D-28 forbid it, and the tutor's listening leg is not yours to touch.

This makes criterion 2's honesty requirement sharper, not softer: **a learner whose correct spoken answer is mis-transcribed must have a way to be right.** Design that deliberately — it is the single most corrosive failure a language app can have, and it lands hardest on exactly this product's user, an advanced speaker with an accent. Say in the PR body what you chose and what happens on the third consecutive mishearing.

---

## Amendment 3 — 2026-07-25 · **Criterion 5 (the speaker predicate) is WITHDRAWN. Do not touch `lib/findings-model.ts`.**

Operator ruling, on being told this milestone would change what analysis surfaces: *"I don't think we need the speaker thing right now, maybe add it in the future."* Context for the ruling: they had just driven the merged E-42 capture path and reported that **record and speech analysis work well**, asking that it be kept and not otherwise changed.

**So criterion 5 is out of this milestone.** `lib/findings-model.ts` is **frozen** for E-45 — do not add a speaker predicate, do not change the inclusion scope, do not alter which findings any surface sees. If your work needs to read findings, read them through the gate exactly as it is today.

**Criterion 6 stands and is unaffected:** `pinFinding` still reads `findings` raw with no inclusion gate, violating CLAUDE.md's own E-17 rule and falsifying `findings-model.ts`'s own comment about itself. Routing it *through* the existing gate changes no scope — it makes one outlier obey the rule every other read site already follows. That is a compliance fix, not a behaviour change, and you must confirm in the PR body that it alters no surface's finding set. If you find that it *does* change what a user sees, stop and report it rather than proceeding.

**What we are knowingly accepting by deferring, recorded so it is not forgotten:** a bystander's mistakes continue to become the learner's cards, slips and drills. E-36 gates *positive* evidence only, `is_user` is still read in two places under two different rules, and the findings gate still has no speaker predicate — so the half of speaker attribution that matters most for accuracy remains unwired. This is a **recorded known limitation**, not a closed issue, and it returns as its own item in v0.8 (→ E-39). The operator's reasoning is sound for now: the analysis output is good today, they have not been bothered by bystander findings in practice, and a change that silently *removes* findings from a path they just judged as working is the wrong thing to ship without their having asked for it.

**Consequence for your scope:** this milestone is now purely about the teaching surface — one lesson format, click-or-voice drills, and answerable card fronts. It touches no analysis behaviour at all. Say so plainly in your PR body.

---

## Exit report — 2026-07-25

```
RESULT: done
PR:     feat/e45-lesson-and-deck
```

Nine infrastructure deaths during this run; the branch was checkpointed twice by the
dispatcher (`eb39b0e`, `91f0dff`). Everything below is re-verified on the final head.

### Criterion by criterion

**1 · One lesson format, ≤5 minutes, syllabus-first — DONE.**
Two disjoint systems became one. `components/item-lesson-runner.tsx` is deleted and
`components/lesson-runner.tsx` — which used to run pattern lessons with a typed
fill-in and a model-graded rewrite — is now the single runner over the single format.
The five minutes are enforced, not promised: `lib/lessons/lesson-budget.ts` gives
every part of a lesson a stated time cost (`READING_WPM = 170`,
`SECONDS_PER_EXAMPLE/NEW_WORD/DRILL = 6/6/20`) and caps it (`MAX_INTRO_WORDS = 110`,
`MAX_EXAMPLES = 4`, `MAX_NEW_WORDS = 10`, `MIN_DRILLS = 2`, `MAX_DRILLS = 5`,
`MAX_DRILL_WORDS = 60`); `lessonMinutes` adds them up and `trimToBudget` subtracts
until they fit. Worst case at every cap simultaneously = 3.7 min, asserted.
**D-27 is the primary path and is tested on an empty database**: `lib/lessons/
syllabus-lesson.ts` builds a complete lesson — explanation, worked examples and real
answerable drills — from the shipped syllabus with **no model call, no key, no
network**. 218 of 266 rules are teachable (≥10 at every CEFR band); every one of
their lessons fits the budget; max is 1.69 min.

**2 · Click or voice only — DONE.** Typed `fill_in` and `rewrite` are gone with
`lib/lessons/grade.ts` and its billed grading call. There is now **one exercise
shape**: a cue, options, one answer, and an `invite` of `click` or `speak`. Options
are mandatory on *both* invites — that is what makes voice safe, because no mic, no
key, denied permission, budget spent or three mishearings all fall back to tapping
instead of a wall. Spoken answers are transcribed through a new `SpeechToText` seam
(`lib/lessons/speech.ts`, D-28's scripted-assessment allowance) and graded
**deterministically** by `lib/lessons/spoken-answer.ts` — never a billed call.

**3 · No card front is ever a bare category word — DONE**, structurally.

**4 · The duplicated category label — DONE.** `CategoryLabel` is off the card front;
it survives only on the back. `app/practice/cards/page.tsx` checked: its category
chip and the front are different lines and no longer duplicate anything.

**5 · Speaker predicate — WITHDRAWN** by Amendment 3. `lib/findings-model.ts` is
untouched. **This milestone changes no analysis behaviour at all.**

**6 · `pinFinding` through the gate — DONE**, and it altered no surface's finding
set: the Phrasebook is the only surface offering a pin and it lists the same
`INCLUDED_FINDING_SCOPE`, so every reachable finding still pins. Mutation-proved.

**Amendment 1 · the grammar/pronunciation collision — DONE**, resolved to one class
by `uncardableReason`: a finding whose correction is textually identical to its quote
corrected no text, so the error was the *sound*; it resolves to the pronunciation
class whatever the stored category says, and is routed to the studio exactly as an
explicitly-labelled one is.

### The `deriveFront` enumeration, and the proof of totality

Signature is now `deriveFront(quote, correction): string | null`. **`category` is not
a parameter** — a function never handed a category cannot emit one, which is the
whole proof for "no front is ever a bare category word", enforced by the compiler
rather than by a test that could rot.

Exactly four exits:

| # | condition | result |
|---|---|---|
| a | `targetLen <= 0` — pure deletion, or nothing changed at all (the pronunciation artifact) | `null` |
| b | `targetLen > MAX_TARGET_WORDS` (4) — whole-sentence rewrite; the normal shape of `phrasing`/`idiom` | `null` |
| c | `!contextIsEnough(...)` — fewer than 2 context words, or a lone context word under 5 chars (the register slip's `Non ____`) | `null` |
| d | otherwise | `before ____ after` |

**Totality:** the codomain is `{null} ∪ {strings W₁…Wₖ ____ Wₖ₊₁…Wₙ}` where every Wᵢ
is a token of the **correction**. So no front can contain the learner's error (D-18
intact) and none can contain an editorial word. `frontIsAnswerable` states this as a
checkable predicate; `tests/cards-answerable.test.ts` drives all five categories ×
5 context shapes × 7 target shapes (175 cases) and asserts every output is either
`null` **or** satisfies the predicate — with `answerableCount > 0` asserted too, so
"no unanswerable front" cannot be satisfied by producing no fronts.

Named cases covered: pure deletion; correction sharing no leading *or* trailing
token; single-word fix (`gatto`→`gatta`); the register slip (`Non voglio`→`Non
desidero`); and the Amendment 1 blurred final vowel under **both** labels.

A card minted before E-45 whose front would now degrade is **retired by suspension**
inside `generateCards` — an invisible-but-still-counted card would be a drills step
that can never complete.

### What this deletes

- `components/item-lesson-runner.tsx` — one of the two runners.
- `lib/lessons/grade.ts` + `app/api/lessons/grade` — **the billed rewrite-grading
  model call**.
- `lib/lessons/generate.ts`, `lib/lessons/lessons.ts`, `lib/lessons/lessons-view.ts`,
  `lib/lessons/estimate.ts` — the pattern-lesson format, its store and its pricing.
- The exercise types `fill_in`, `rewrite` and the typed `cloze`. **Typing is gone
  from the daily flow — there is no field to type into.**
- `app/practice/lessons/**`, `app/api/lessons/{generate,grade,patterns,complete}`,
  `lib/use-lesson.ts`, `e2e/lessons.spec.ts`.
- The `` `____ · ${category}` `` degradation, and `category` from `deriveFront`.
- The duplicated `CategoryLabel` above the card front.
- The per-category lesson prescription and its price from `lib/plan.ts`.
- The runner's `budget` phase and the route's 402/502 walls.
- An unreachable trim loop in `trimToBudget` (a guard no input could reach is a
  guard no test can hold — replaced by a caps assertion that *does* go red).
- Net: **−2,861 lines against +3,803**, but concepts go firmly down: 2 lesson
  systems → 1, 4 exercise types → 1, 2 runners → 1, 2 grading paths → 1.

### Product calls (the price of the authority)

1. **The deterministic syllabus lesson is the primary path, not a fallback**
   (D-27). Chosen over "generate or fail" because a lesson that needs a key, a
   budget and a network is a lesson that is absent on the days a learner most needs
   the habit. Rejected: a keyless empty state; it is exactly the inertness v0.6 was
   judged on.
2. **No model-minted card front** — contradicts criterion 3's optional clause, and I
   say so plainly. It needs a cache table, i.e. a migration, which this batch
   forbids (E-44 owns v30); it adds a biller where D-26 demands subtraction; and the
   deterministic front plus honest non-cardability already holds the invariant. The
   cost is a thinner deck: of 11 seeded findings covering every shape, 4 became
   cards. That is the right trade now the lesson comes from the syllabus, and it is
   a candidate for a later milestone with a migration in hand.
3. **A lone context word is allowed if it is a content word (≥5 chars).** A bare
   count could not tell `"____ problema"` (answerable — the canonical Italian gender
   error) from `"Non ____"` (hopeless). Justified by the card being *self-graded*:
   the bar is "can you retrieve the target", not "is your answer provably unique".
4. **A rule that cannot be taught substitutes a neighbour from the same CEFR band**
   rather than 404ing, and the lesson carries the substitute's `itemId` so evidence
   lands on what was actually taught. Found by driving, not by reading.
5. **No fuzzy matching on spoken answers, deliberately.** In Italian a one-character
   difference is usually the error under test (`gatto`/`gatta`, `fossi`/`fosse`).
   Asserted as a requirement, so a later "helpful" edit-distance goes red.
6. **`/api/lessons/speak` degrades with 200 + a reason**, never an error status: a
   failure to hear is not the learner's failure and must not read as one.

### The mishearing design, and the third consecutive mishearing

Our learner is an advanced speaker with an accent; marking their correct answer
wrong is the most corrosive thing this app can do. So:

1. **the transcript is shown** — "I heard: *il problema*" is a fact they can judge;
   a bare "Not quite" is an accusation they cannot argue with;
2. a wrong verdict on a **spoken** answer offers one control — **"That's not what I
   said"** — and taking it marks the drill correct. The learner is the authority on
   what came out of their own mouth;
3. an overridden drill writes **no evidence at all**. Not positive (unverified), and
   emphatically not negative. **A mishearing never becomes a data point against the
   learner;**
4. **on the third consecutive override** (`MISHEARD_STREAK_TO_FALL_BACK = 3`) the
   runner **stops offering speech for the rest of the session** and says so once:
   *"Speech recognition isn't hearing you well today. The rest of the drills are
   tap-only."* Once is noise; twice could be; three in a row is recognition not
   working for this voice today, and continuing to offer it is asking someone to
   keep failing at something we already know is broken. Nothing is lost — the drills
   are the same drills, answered by tapping.

The risk is not theoretical: in the live round-trip below, a spoken `"ho"` came back
as an **empty transcript**.

### Mutation proofs — 19 mutants, 19 killed

Cards (`e45-mutate-cards.sh`, baseline 58): M1 raw-`findings` read restored → 1 red ·
M2 context clause deleted → 7 · M3 tie-break neutered → 1 · M4 retirement sweep
removed → 1 · M5 `MAX_TARGET_WORDS` deleted → 1 · M6 shape filter removed → 5 ·
M7 solo-context floor removed → 3 · M8 `targetLen<=0` deleted → 8.

Lessons (`e45-mutate-lessons.sh`, baseline 76): L1 truncation detection deleted → 4 ·
L2 bounded repair removed → 3 · L3 truncated call not billed → 1 · L4 syllabus
fallback removed → 6 · L5 drill floor lowered → 1 · L6 cue-contains-answer guard
deleted → 2 · L8 fuzzy tolerance added → 1 · L9 substring containment → 1 · L10
drill top-up removed → 1 · L11 options made optional → 2 · L12 answer-key check
removed → 1. Plus: raising `MAX_DRILLS` to 14 reds the caps assertion (the guard that
replaced the deleted trim loop).

**Four survived on the first pass (L5, L7, L11, L12) and were fixed rather than
shipped** — L7's guard was genuinely unreachable and was deleted; the other three
got tests that isolate each clause.

### The billed-and-empty defect (handed over mid-run)

Root cause: `openAiTextModel` **discarded `finish_reason`**, so a reply cut off at
the ceiling was indistinguishable from a malformed one — billed, unparseable, and
reported as "the lesson model returned an unreadable response". Fixed at the
invariant, not the instance:

1. the ceiling is **derived** from the content budget (`lessonOutputTokenCeiling()`
   = 1800), not picked;
2. truncation is detected (`TextModelTruncatedError`, `wasTruncated`);
3. **one** bounded E-16 repair asks for the minimum lesson with double the room,
   separately reserved and separately billed (folding two calls into one charge
   would understate spend);
4. a partly-bad reply is **topped up** from the deterministic drills instead of being
   rejected whole;
5. and `todaysLesson` cannot fail — every failure lands on the syllabus lesson.

**Measured, not guessed:** 12 live `gpt-4.1-mini` calls on this repo's own prompts
returned **499–770 output tokens (mean 623), all `finish_reason: "stop"`** — I could
**not** reproduce truncation at the shipped 1400. Forcing a 200-token ceiling
reproduced the whole chain: **6 of 6 truncated, 6 of 6 unparseable.** The new ceiling
sits ~2.3× above the measured worst case.

### Verification, and which server answered

`npm run build` ✓ · `npx tsc --noEmit` ✓ · `npx vitest run` **1186 passed, 135
files** ✓ · `npx eslint app lib components tests --ext .ts,.tsx` **0 errors**, 12
pre-existing warnings ✓ · `.mfactory/hooks/run-tripwires.sh --all` ✓ (9 rules, 550
tracked files). `npm run lint` was a **no-op** in a nested worktree; this branch adds
`"root": true` to `.eslintrc.json`, the same fix master took.

**Drove the built server twice** (`next start`, disposable `ERIKA_DATA_DIR`, never
`data/erika.db`), seeded with a corpus containing every known-bad finding shape.

**Proof of responder** — three independent checks, all stated:
- **PID**: `lsof -t -iTCP:39461` returned `66236`, whose parent is the `66213` this
  script spawned. Nothing else could have answered.
- **Build fingerprint**: `/api/plan` returned keys `dueCount,letterUnread,letterWeek`.
  **Master still returns a `lesson` key**; E-45 removes it. A pre-E-45 server would
  have failed this assertion and the script aborts if it does.
- **Database**: `ERIKA_DB_PATH` under `/var/folders/.../erika-e45-drive-*/erika.db`,
  confirmed to exist.

Keyless: a real grammar lesson (`deterministic=true`), 2 drills, one `click` and one
`speak`, both answerable; the lesson page renders; `/api/lessons/speak` returns
`200 reason=unavailable` (degrades, no wall); 4 cards, every front a context gap, no
bare category word, 7 unanswerable shapes correctly minted nothing.
Keyed: the generated lesson for the *composer's own* rule with 3 drills.

**The first drive FAILED and found a real wall** — a grammar item 404'd because the
composer had queued one of the 48 unteachable rules. Fixed (product call 4) and
re-driven green. This is the handover's lesson exactly: reading finds wrong logic,
driving finds features that do not exist.

**Live STT round-trip** (product's own `openAiSpeechToText` + `gradeSpokenAnswer`):
5/5 correct. `"perché"` → heard `"Perché?"` → accepted (accent folding earned its
keep); `"gatto"` for answer `"gatta"` → **refused** (no fuzzy matching); `"ho"` →
**empty transcript** → refused, which is precisely the mishearing the override exists
for.

**Spend: $0.019** (measurement 12 + 6 calls $0.0160, keyed drive ~$0.0013, STT
round-trip $0.0019). Cap was $0.40.

### Reaching across the seam — declared

Three files outside my list were touched, all forced by deleting the pattern-lesson
format, all in the direction E-44 is already going. Flagging them for the rebase:
- **`lib/today.ts`** — 3-line removal of the `PlanLesson` passthrough (E-44 already
  removes this field).
- **`app/practice/page.tsx`** — removal of the "Work on next" row. Not optional: it
  linked to `/practice/lessons/[key]`, a page this PR deletes, so leaving it would
  ship a 404.
- **`lib/plan.ts`** — `prescribeLesson`/`PlanLesson` deleted with the format.
Resolution on conflict: **take E-44's version.**

### Risks and anything unverified, named plainly

- **Drill quality is heuristic.** Distractors come from the rule's other example, so
  a distractor could in principle also be correct in the slot. Mitigated (never a
  token already in the sentence, capitalisation must match, the cue never contains
  its own answer) and every generated drill is asserted structurally answerable — but
  it is not semantically verified, and I am not claiming it is.
- **48 of 266 rules cannot be taught deterministically**; they substitute a
  neighbour. With a key the model teaches the real rule (proved in the keyed drive).
- **The STT rate ($0.006/audio-min) is a stated floor at ~2× the published rate**,
  not a reconciled figure. Direction is safe (over-estimating refuses slightly early).
- **`recordCompletion` (`lesson_mastery`) now has no caller.** It fed
  `lib/analysis/profile.ts`; existing values stand, new ones stop accruing. The
  module and its data are untouched; this is a consequence of deleting the format
  that produced them, and it is recorded rather than hidden.
- **No vocabulary lesson without a key** — there is no offline Italian→English gloss
  source in this repo (the licence-clean assets are frequency lists, not a
  dictionary). The route says so truthfully and the composer's grammar items always
  work.
- **The runner's React state (mishearing streak, override) is not DOM-tested.**
  `useRecorder`/`MediaRecorder` need a browser; the pure grading, the constant and
  the fallback rule are unit-tested, the UI wiring is verified by reading.
- **Not verified:** a human actually speaking into the mic in a browser. The STT
  seam is proved live end to end with synthesised speech, not with a real accented
  voice — which is the population the design is aimed at.

Tests changed/removed: `lessons-parse`, `lessons-engine`, `lessons-route`,
`lessons-schema`, `lessons-view`, `e2e/lessons.spec.ts` deleted with the format they
covered; `item-lessons-parse` rewritten for the new parser; `item-lessons-schema`,
`item-lessons-engine`, `plan`, `honest-home-routes`, `analysis-profile` updated to
the new shapes. **Six suites had placeholder fixtures (`q0`→`c0`, `"a"`→`"he goes to
work"`) that stopped producing cards under the new shape rule; they were made
realistic rather than the rule relaxed (D-13).**

Review tier: **Full**, unchanged — money (a new biller and a repriced ceiling), an
external contract (the STT endpoint), and the card read-model.
