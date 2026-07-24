# WO-voice-canon — E-33: voice & canon + the register dial

Target repo: immaculatecross/erika · Branch: `feat/voice-canon` · **Review tier: Full**
<!-- Full: the TTS RENDER money path (reserve-before-call/cache/ledger — never-waivable spend) +
     a register dial injected into MULTIPLE money/analysis surfaces (analysis recasts, lesson
     generation, TTS). A committed license-clean canon asset (D-19 license discipline). -->

## First action
Branch `feat/voice-canon` off latest `master`; empty commit + `git push -u origin feat/voice-canon` first. **Also `git add` your work-order file (`.mfactory/work-orders/WO-voice-canon.md`) in your first real commit so it lands in the PR** (a prior milestone lost its WO to an untracked worktree copy — don't repeat it).

## Boot
`STATE.md` → `FEATURES.md` (E-33 row) → `DECISIONS.md` (**D-21** pronunciation = LLM flags + Azure scoring scripted-only; **D-23** italiano colto register; **D-19** license-clean; **D-20** spend) → `HANDOVER.md` → `CLAUDE.md` → `DESIGN.md` (binding) → `docs/schema.md` → `.mfactory/playbooks/task.md`. Read what you build on: the **E-21 render engine** (`lib/renditions|render/*`, the contrastive TTS, reserve-before-call + cache + ledger), the **E-32 lesson prompts** (`lib/lessons/item-lessons.ts` — the `registerLine`/colto injection point you generalize), the **analysis recast** prompts (E-4/E-28), Settings (`lib/settings.ts`), and the composer (`lib/compose.ts`).

## Objective
Erika gains a **register dial** the learner controls and **two new practice formats** that use the voice engine: **listen-and-shadow pronunciation** and **reading/listening from the public-domain canon** at the learner's edge.

## Acceptance criteria
1. **The register dial (D-23).** A Settings control **colloquiale → colto → letterario** (default **colto**), persisted like other settings. Its value is injected as a register instruction into **every** generation surface: **analysis recasts** (the correction voice), **lesson generation** (E-32 — replace the hardcoded colto default with the dial), **TTS instructions** (the render engine's voice/style), and a **documented hook for the tutor persona** (E-34 not built — leave a clearly-marked injection point + a test that the hook receives the dial). Pure injection; tests assert the dial value reaches each prompt/instruction builder (a fixture per surface). Changing the dial changes only *style/register*, never correctness.
2. **Listen-and-shadow pronunciation format.** A drill that **renders a correct target phrase** (from the item's example / the finding's recast — never the learner's error, D-18) through the **E-21 render engine** with Italian TTS instructions, plays it, and lets the learner **record a shadow take** that lands through the **normal capture→ingest** path (a session like any other). **No pronunciation scoring here** — scoring is Azure/E-37 (D-21: scripted drills only, scored later). The render reuses E-21's **reserve-before-call + per-phrase cache + ledger** (a re-play makes zero model calls / zero bill). Tests: the shadow target is a correct form (not an error); the render is cached (one ledger row per phrase, replays bill zero); the cap refuses truthfully.
3. **Reading/listening from the canon, at the learner's edge.** Ship a **modest, committed, license-clean public-domain Italian canon** (a curated set of leveled passages — e.g. public-domain classics; **PUBLIC DOMAIN only**, attribution/provenance in a NOTICE, D-19 license discipline; keep the asset small — this demonstrates the format, it is not a library). A reading surface presents a passage **matched to the learner's edge** (by `freq_rank`/CEFR band of its vocabulary vs. the learner's knowledge state) with an optional **listen** (TTS render, cached/ledgered). Unknown lemmas in the passage may surface as new-item candidates (optional; do not double-charge). Tests: passage selection respects the edge (a beginner gets an easier passage than an advanced learner); the asset is public-domain + attributed; listen render is cached.
4. **Money + evidence discipline.** All TTS renders go through the **one** E-21 biller (reserve-before-call, cache, finalize-to-actual, hard cap cross-biller) — **do not fork a second money path**. If reading/shadow completion writes evidence, it goes through the E-25 append-only door with an honest mode. No unrecorded spend, no cap bypass.
5. **No `OPENAI_API_KEY` in the sandbox** — fixture-test all render/parse/cache/money mechanics behind the model-client seam (mirror E-21/E-32); document the one real-API smoke as an operator-key-gated follow-up (do NOT fabricate it). Verify against **disposable** state.
6. **Gates + DESIGN + ritual.** `lint`/`typecheck`/`test`/`build` + tripwires green; DESIGN-faithful (calm reading surface, the shadow player per DESIGN motion, Lucide/Motion only, no third accent hue); any new table → migration **v21** + `docs/schema.md` same PR. **Solo milestone — do the FEATURES/STATE ritual IN THIS PR** (E-33 → done, regenerate STATE).

## Files and constraints
- New: register-dial Settings + a shared `registerInstruction(setting)` injected everywhere; the shadow drill format + UI; the reading format + UI; `lib/canon/*` (the committed passages + a small loader + NOTICE) — keep any source module < 500 lines; the canon asset is data. Changed: E-32 lesson prompts (use the dial), analysis recast prompt (use the dial), the render engine's TTS-instruction builder (use the dial).
- Contracts that must not break: the cap stays hard cross-biller; renders reuse E-21's cache/ledger; `evidence` append-only; `lib/findings-model.ts` authority; `knowledge_items` rebuildable. License-clean shipped data only (public domain + attributed). Conventional Commits; hooks; 500-line/file; disposable state; never commit `data/`/`.env*`.

## Out of scope
- **Pronunciation SCORING** (Azure Pronunciation Assessment) — that is **E-37** (D-21); E-33 only renders + records the shadow take. The **tutor** (E-34) — leave the register hook, don't build the tutor. The streak/map (E-38). Speaker attribution (E-36).
- A large canon/corpus — keep the committed asset modest; do not clone or ship a big library.

## Exit report
Append to the WO per `task.md`: RESULT / PR / Changed / Verified (commands + the dial-injection fixtures per surface + the render-cache/cap money tests + the edge-selection test + the canon license note) / Tests / Risks / Blocker.
