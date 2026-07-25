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
