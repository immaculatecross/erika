# WO-E46 — First run, and progress you can see

Target repo: github.com/immaculatecross/erika · Branch: `feat/e46-first-run-and-progress` · **Review tier: Full**
Batch: **solo, serial, last in v0.7.** Depends on WO-E43 (the STT seam), WO-E44 (the session and the Library) and WO-E45 (the deck), all merged. Carries **no migration** unless criterion 4 forces one; if it does, it is the next free number. The **dispatcher**, not you, performs the FEATURES.md/STATE.md ritual.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md` (row E-46), `DECISIONS.md` (**D-26**, **D-19**, **D-22**, **D-24**), `HANDOVER.md`, `CLAUDE.md`, **`DESIGN.md` in full — this milestone is judged on how it looks**, then `.mfactory/playbooks/task.md`.

## Objective

Two halves, both about a learner meeting this product for the first time and staying with it.

**First run is not real.** There is no gate anywhere: `middleware.ts` is a no-op principal stamp, the shell renders the same two tabs on an empty database, and placement is a *dismissible row* explicitly commented "never a hard gate". A new learner therefore lands in an app that knows nothing about them and never insists on learning anything. The operator: *"make sure the onboarding is a real one — when you launch the app for the first time, there's no DB, it should really force you to go through the onboarding."*

**And progress is invisible.** The knowledge core built in E-25 — every word, rule and sound the learner has shown they have — is visible only through a dev-only inspector at `/dev/knowledge`. The operator has never seen it: *"I've not seen the knowledge graph. It would be nice to see someone progressing."* And, on how it should feel: *"show progress but make it sexy and user friendly."* That is the brief, held against DESIGN.md's restraint — sexy here means beautifully made, not decorated. This ratifies the operator-gated RETRO-002 P6 proposal, a read-only "what Erika knows about you" surface.

## Acceptance criteria

1. **An empty database forces onboarding, and cannot be navigated around.** Any route on a database with no learner profile lands in onboarding — including a deep link straight to `/practice` or a Library page. A learner who *has* a profile is never trapped by it. Test both directions; the second is where this kind of gate goes wrong.
2. **Onboarding says what Erika needs, before the learner discovers it the hard way.** In plain prose, once: an **OpenAI API key is required** and where it goes; recordings are **analyzed automatically**; there is a **monthly cap**; the **worker process** must be running for anything to be processed. The server can report whether a key is actually present — say so truthfully rather than instructing blindly. Today the only place a new user learns a key is needed is a leaked internal error string on the tutor screen, and the app's own remedy for a stalled ingest was a loop; that is what failed the v0.6 cold-start gate.
3. **Keep the vocabulary check; add a voice.** The yes/no frequency-band check works and the operator said so — leave its scoring alone. Add **one or two short spoken prompts** through E-43's `SpeechToText` seam, so level is inferred from real **production** as well as recognition, and record the ~45 s E-36 enrollment take in the same pass (D-22: on-device, never uploaded). The spoken sample also gives a genuinely yes-biased advanced learner **an escape from the false-alarm refusal**, which today offers no route but retaking the check — the last open item in RETRO-004 §1.
4. **Placement's correctness rules are untouched.** Recognition-only evidence seeds `introduced` and **never** `known` (D-19). `level` remains the top of the **contiguous** run from A1; `calibrated` can never read true above the false-alarm threshold; supersession stays the INSERT-only read-path rule on `placement_runs` (v27); and the single predicate that gates **both** presentation **and** seeding stays single — a careless run must not silently seed, and an honest retake must not silently erase. Every one of those was a v0.6 blocker; re-prove them, do not merely preserve them.
5. **Onboarding ends inside a real first session.** Not a congratulations screen, not the home with a prompt — the learner's first session, composed from what the check just learned about them.
6. **Progress: what Erika knows about you.** A read-only surface showing the words, rules and sounds the learner has shown they have; what moved this week; what is still fossilized; and the knowledge map done properly rather than as a strip. Reached from the Learn home (the ring is the natural affordance) and from the Library. It **replaces** `/dev/knowledge`.
7. **Every number on it is honest, and green still means mastery.** Figures derive from the knowledge core and `computeSlipStandings` — the *same* standing Focus reduces, so the product keeps one notion of mastery. Green tints only through resolved-slip semantics; heavy activity with nothing resolved stays neutral (D-24, tested under load in v0.6 — keep that test honest). Where there is no evidence yet, say **"not started"** rather than rendering a fake 0% — the v0.6 review lenses singled out this repo's empty states as genuinely good; do not regress them. No claim of a return or a trend that no code path implements.
8. **It is the best-looking screen in the app.** DESIGN.md is binding and its restraint is the point: Apple system palette, accent black in light and white in dark, green and red **only** where a state carries meaning, tabular numerals for every statistic, cards at 18px, springs at stiffness ≈260 / damping ≈28, transform and opacity only, list stagger 30–45 ms, **one** signature moment, and `prefers-reduced-motion` degrading everything to fades. D-24's ban list applies here as everywhere: no confetti, mascots, XP, points, levels, leaderboards or badges — a progress surface is exactly where those try to creep in. Walk it in a browser in **both** light and dark and at a phone viewport, and attach what you saw to the exit report.

## What this milestone deletes

Your PR body carries a **"What this deletes"** section. Expected: `/dev/knowledge` and its API, the dismissible placement prompt, and the "discover the requirements from an error message" path. If concepts go up on net, justify it.

## Files and constraints

Centre of gravity: `middleware.ts` or the shell's routing seam, `app/practice/placement/page.tsx` + `components/placement/**`, `lib/placement/**` (scoring untouched), `lib/knowledge/**` (read-only use), `lib/knowledge-map.ts`, `lib/slip-standing.ts`, `components/knowledge-map.tsx`, a new progress route, `app/dev/knowledge/page.tsx` + `app/api/dev/knowledge/route.ts` (removed).

Must not break: append-only `evidence` and its v14 triggers; D-19's `known` corroboration; `lib/findings-model.ts` as the one gate, **including E-45's new speaker predicate**; D-22 on-device and recall-first; the E-31 `day_ledger` and `lib/streak/`; reserve-before-call and the hard cap.

Repo rules: Conventional Commits (subject ≤72 chars), 500 lines per file, never edit a shipped migration, never commit `data/` or `.env*`, disposable database only — and note that this milestone is *about* the empty-database path, so a disposable database is not merely hygiene here, it is the subject.

## Out of scope

The session runner and day completion (WO-E44, merged); lesson and card content (WO-E45, merged); the tutor internals (WO-E43, merged); the Record tab (WO-E42, merged); a "delete everything Erika knows" control (not asked for); `FEATURES.md`/`STATE.md`.

## Verification

This milestone's subject **is** the cold start, so verify it the way the gate does: `rm -rf` a disposable data directory, build, start, and walk in from nothing — in a browser, light and dark, phone viewport. **Prove which server answered you** (unusual port, assert a string unique to your build) and state the proof; a verification once hit another session's stale server and returned confident, wrong answers. Mutation-prove every new guard, especially the routing gate (make the profile check always-true and show a test go red). Before writing criterion 1, state the invariant and enumerate every path that could violate it — then ask what the opposite failure looks like, because it is a learner **locked out of their own populated app**, and that is worse than the defect being fixed.

Gates green plus tripwires. **Branch and push first**: empty commit and `git push -u origin feat/e46-first-run-and-progress` as your very first action.

## Exit report

Append here and **write it before returning**. Include the criterion-by-criterion status, the "What this deletes" list, the enumeration for criterion 1 with both directions tested, the re-proof of criterion 4's placement invariants, the mutation proofs, the proof of which server answered, and a plain description of how the progress surface looks in light and dark at phone width.
