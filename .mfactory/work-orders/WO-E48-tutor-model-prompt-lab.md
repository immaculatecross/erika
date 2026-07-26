# WO-E48 — Tutor model and prompt lab

Target repo: github.com/immaculatecross/erika · Branch: `feat/e48-tutor-model-prompt-lab` · **Review tier: Full**

Batch: **pipelined behind E47 while PR #94 is in review, by operator direction.** Start from
`origin/master`; do not touch E47's lesson-preparation files. E47 owns migration v31. This
milestone uses **no migration** and must rebase onto E47 after it merges, then rerun every
gate. The dispatcher, not the worker, performs the FEATURES.md/STATE.md completion ritual.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md`, `DECISIONS.md` (especially D-3, D-19,
D-23, D-24, D-26 and D-28), `HANDOVER.md`, `CLAUDE.md`, `DESIGN.md`,
`docs/research/spike-5-voice-loop.md`, `spike-6-tutor-listening.md`, and
`spike-7-realtime-voices.md`; then `.mfactory/playbooks/task.md`.

## Objective

Turn the tutor into a controlled, visible research lab for the operator without losing the
daily-session contract. The learner explicitly marks each turn with **Tap Speak → Tap Done**,
so no VAD decides where a hesitant sentence ends. Before starting, an unobtrusive experiment
panel offers two listening architectures and five prompt presets. Both architectures return
the same structured turn result and speak through the same OpenAI TTS leg, so differences in
error detection, reply quality, latency and cost can be compared rather than confounded by a
different voice.

The two architectures are:

1. **Native listener:** `gpt-realtime-2.1`, native audio input, text output, manual buffer
   commit, then OpenAI TTS.
2. **Transcript listener:** `gpt-4o-transcribe` → `gpt-5.6-terra` (low reasoning effort,
   unless a live contract probe proves a different supported spelling) → the same OpenAI TTS.

Default remains **Native listener + Current tutor**. The transcript architecture is an
operator-visible experiment, not a reversal of D-3 and not a new claim that STT preserves
learner errors.

## Acceptance criteria

1. **One calm experiment panel, five presets, two paths.** On the tutor's pre-start surface,
   a collapsed disclosure labelled as an experiment lets the operator select:
   - Native listener — Realtime 2.1
   - Transcript listener — OpenAI STT + GPT-5.6 Terra

   and these prompt presets:
   - Record-equivalent detector
   - Minimal detector
   - Balanced coach
   - Precision first
   - Current tutor

   Each option has one exact sentence explaining what changes. Native + Current is selected
   by default. The choice is frozen while a conversation is live and can change between
   conversations. Do not add five permanent Settings knobs or disturb Learn's one primary
   action; this is one disclosure on the conversation surface.

2. **Manual turns replace VAD in both paths.** Starting a conversation does not continuously
   submit learner speech. During the call one primary control cycles `Speak` → `Done` →
   processing → `Speak`. The mic reaches the active model only between Speak and Done.
   Realtime sessions use `turn_detection: null`; Done sends exactly one
   `input_audio_buffer.commit` and one `response.create`. The transcript path sends exactly
   one bounded turn recording on Done. A pause, hesitation, or self-correction cannot split a
   turn; waiting while recording cannot create a response; double taps cannot duplicate a
   billable turn. Keep a separate End conversation control.

3. **Native architecture is really native-in/text-out/TTS.** Reuse the existing WebRTC and
   ephemeral-secret boundary, but configure `gpt-realtime-2.1` with
   `output_modalities: ["text"]` and no turn detection. Parse its completed text into the
   shared turn contract below, then synthesize only `reply`. The real API key never reaches
   the browser. Mine commit `84bd39f` for the previously working text-out/TTS implementation,
   but re-derive it against today's tree and current provider contract rather than reverting
   that commit wholesale.

4. **Transcript architecture is really STT → Terra → TTS.** A server route accepts one
   bounded audio turn, validates its bytes and server-derived duration, calls
   `gpt-4o-transcribe` with an Italian hint, then calls `gpt-5.6-terra` with the selected
   prompt and bounded conversation context. Use the current supported API field for low
   reasoning effort and structured output, proven by a cheapest-possible key-gated contract
   test. Do not reuse the 15-second drill seam's limit or pretend spontaneous conversation is
   a scripted answer; extract/generalize only vendor mechanics that are genuinely shared.

5. **One parsed turn contract, detection separate from speech.** Both paths cross the same
   parsed boundary:

   ```ts
   type TutorTurnResult = {
     errors: Array<{
       quote: string;
       correction: string;
       category: "grammar" | "vocabulary" | "phrasing" | "idiom" | "pronunciation";
       explanation: string;
       confidence: "high" | "medium";
     }>;
     reply: string;
     evidence: Array<{ itemId: string; polarity: "correct" | "incorrect"; mode: "spontaneous" | "cued" }>;
   };
   ```

   Invalid, fenced, truncated, or off-schema output gets one bounded repair and then a
   truthful recoverable message; it never reaches TTS and never writes evidence. Display all
   detected errors in the experiment details, while `reply` remains a short conversation turn
   that normally speaks at most one correction. An empty error list is valid and expected.

6. **The five presets isolate real hypotheses.** Build them in one pure
   `lib/tutor/prompt-presets.ts` module from shared prompt parts; do not paste five drifting
   personas.
   - **Record-equivalent detector:** reuse the Record path's `mistakeClasses`,
     `precisionCore`, category mapping, and “identify each genuine error / empty is valid”
     policy. Put every genuine error in `errors`; the spoken reply still selects at most one.
   - **Minimal detector:** only role, target language, error classes, precision core, empty-is-
     valid, brevity, and the output contract. No profile, slips, today's targets, recurrence
     pressure, or “most important job” language.
   - **Balanced coach:** inspect the whole turn and list every clear error internally; speak
     the single most useful correction, then continue naturally. Correct speech gets ordinary
     conversation, not a forced correction.
   - **Precision first:** a correction requires high confidence; valid regional/register
     variants pass; acoustic uncertainty asks for repetition instead of guessing; there is
     no quota to find an error.
   - **Current tutor:** preserve today's `buildTutorPersona` detection and one-correction
     policy, adding only the shared structured envelope needed by this lab.

   Tests pin each distinguishing clause and prove the selected preset is the exact prompt sent
   by both provider paths.

7. **STT's limitation is explicit and enforced.** In the transcript path, show the transcript
   in the experiment details and state once: “This path can compare grammar and word choice,
   but a transcript cannot preserve pronunciation or hesitation.” Its prompt must forbid
   pronunciation findings and the parser must reject/drop them visibly rather than teaching a
   pronunciation claim inferred from text. The native path may report pronunciation. Never
   silently present the transcript as what the learner certainly said.

8. **The common output leg is streaming and current.** Both paths synthesize `reply` through
   the same OpenAI speech route, same selected voice, same buffering/player, and same rate
   model. Use `gpt-4o-mini-tts` unless the live contract probe proves it unavailable; official
   guidance still names it the quality/realtime default even though the model catalogue marks
   it deprecated. If unavailable, fail truthfully and report the contract conflict instead of
   silently changing the experiment to a lower-quality model. Restore/rework the streaming
   seam from `84bd39f`; do not bring back dead sentence-queue complexity that a one-reply JSON
   contract does not need.

9. **Conversation continuity and Erika's invariants survive.** Register, learner profile,
   active slips, today's validated targets, brevity, anti-narration, correction-forward
   behavior and the `log_evidence` validated-id boundary remain available to every preset
   except where Minimal deliberately removes learner-specific priming. Evidence from either
   path is written only through the existing server validator; invalid ids are rejected and
   never minted. The full call is still recorded locally, uploaded as WAV, linked to
   `tutor_conversations`, and analyzed through the normal native-audio Record path after End.

10. **The comparison is inspectable, not just audible.** A compact experiment-details
    disclosure shows the last completed turn's selected architecture/preset, STT transcript
    when applicable, structured errors, reply text, latency by available leg (capture commit,
    transcription, model, first TTS audio, total), and that turn's committed/modelled cost.
    Missing provider usage is labelled modelled, never “actual.” Normal tutor dots, progress,
    turn state and D-24 copy remain calm; no dashboard, charts, third accent color, avatar or
    waveform.

11. **Every billable leg stays on the one money spine.** Realtime text input/output and its
    prompt cache, STT, Terra input/cached/output/reasoning tokens, and TTS are priced at or
    above current published/measured reality, reserve before each call, and finalize on
    resolve. A cap refusal makes no provider call and creates no phantom conversation or
    evidence. Resolved-but-unparseable model output is still charged. The native path's
    long-lived lease and transcript path's per-turn reservations cannot double-book one
    another. Post-conversation cost remains the committed total. Add leg-wise floor tests;
    under-pricing is the dangerous direction.

12. **External contracts and secrets are proved cheaply.** Key-gated smoke tests exercise one
    manual Realtime text-out turn, one STT transcription, one Terra structured response, and
    one TTS stream with the production request builders. Tests assert parsing and supported
    fields, not model quality. No request, error, fixture, log or PR body may expose the API
    key or an ephemeral secret.

13. **Run the controlled comparison after the UI works.** Against a disposable database and a
    hard live-spend ceiling of **$1.50**, run the same labelled set (at least three planted
    grammar/word-choice errors and two correct controls) through both architectures and all
    five presets. Record per cell: caught/missed, false correction, parse failure, latency to
    first audio, and modelled/usage-derived cost. File the method and results as
    `docs/research/spike-8-tutor-model-prompt-lab.md`. Synthetic/TTS fixtures prove plumbing,
    not real-learner judgment: say so explicitly and do not crown a winner from them. If the
    key or contract is unavailable, leave the harness and report the live matrix as gated,
    never fabricate results.

14. **Record the temporary research decision.** After rebasing E47, add D-30: the operator
    authorized a manual-turn A/B lab because VAD and prompt policy are suspected confounders;
    Native + Current remains the default until human use decides; STT is an experiment whose
    displayed limitation preserves D-3's warning. Add E-48 as `building` in v0.8, but do not
    mark it done or regenerate STATE.md; the dispatcher performs the completion ritual.

## Files and constraints

Centre of gravity:

- `app/(app)/practice/tutor/page.tsx` — already near the 500-line cap; extract hooks/components
  rather than growing it
- `components/tutor/**` for experiment controls and turn details
- `lib/tutor/session-config.ts`, `realtime-client.ts`, new manual-turn orchestration
- `lib/tutor/prompt-presets.ts` and the shared turn parser/contract
- `app/api/tutor/session/route.ts`, a transcript-turn route, and a TTS route
- restored/reworked `lib/voice/**` from commit `84bd39f`
- `lib/analysis/rates*.ts`, tutor money code, and focused money tests
- `docs/research/spike-8-tutor-model-prompt-lab.md`

Binding constraints: no migration; D-18 correction-forward/error-once; D-19 append-only
evidence and validated ids; D-23 register; D-24 calm UI/ban list; E-17 findings gate untouched;
one spend spine; reserve before every provider call; resolved calls ledgered even when parsing
fails; real key server-only; source files under 500 lines; Conventional Commits; disposable
database only.

## Out of scope

- Changing the Record analysis cascade or using STT for post-session findings.
- Making the transcript architecture the default or declaring it better from synthetic audio.
- Adding Gemini, Grok, Cartesia, ElevenLabs, Realtime Mini, GPT-5.6 Sol, or more selectors.
- Comparing TTS models or voices; the output leg must stay constant.
- Semantic VAD or any automatic end-of-turn fallback.
- E47 lesson preparation, E39 debt, hosted/iOS work, or a schema migration.
- Removing the existing native-audio recording → analysis path or weakening the monthly cap.

## Gates that will not tell you the truth locally

- Run `.mfactory/hooks/run-tripwires.sh --all` before opening the PR. The pre-commit hook scans
  only staged files.
- `npm run lint` must inspect files; if suspiciously quiet, verify with
  `npx eslint . --ext .ts,.tsx`.
- Run build and typecheck sequentially because build rewrites `.next/types`.
- Browser proof must bind a random port and prove both process identity and build identity
  before trusting any result.

## Verification

Required: focused tests with mutation proof for manual commit/no-auto-response, selected-prompt
wiring, invalid structured output, STT pronunciation rejection, secret boundary, and every
new spend guard; then sequential `npm run lint`, `npm run typecheck`, `npm run test`,
`npm run build`, `.mfactory/hooks/run-tripwires.sh --all`.

Drive the built UI on a random port and disposable database through both architectures:
Start → Speak → pause mid-sentence → continue → Done → inspect errors/reply/latency → hear TTS
→ second turn → End → verify WAV session linkage and committed spend. The live benchmark in
criterion 13 is authorized up to $1.50 total. Never touch `data/erika.db`.

**Branch and push first:** create an isolated worktree, branch
`feat/e48-tutor-model-prompt-lab` from `origin/master`, make an empty Conventional Commit, and
`git push -u origin feat/e48-tutor-model-prompt-lab` before implementation. Copy this work
order into the worktree so it lands durably on the branch. Rebase onto master after PR #94
resolves and rerun all gates before requesting merge.

## Exit report

Append before returning:

`RESULT / PR / Changed / Verified / Tests changed or removed / Risks / Blocker`

Also include: exact wire events for a manual Realtime turn; exact STT/Terra/TTS model ids and
reasoning field accepted live; prompt text/hash per preset and proof both paths received it;
per-leg money proof; benchmark table and spend; browser/build identity; latency to first audio
for both paths; whether E47 was merged/rebased; and every live verification not performed.

### Worker exit — 2026-07-26

**RESULT** — Complete on `feat/e48-tutor-model-prompt-lab`. The branch implements both
manual-turn listener architectures, five fixed prompt hypotheses, one strict turn boundary,
one shared streaming speech leg, leg-wise spend controls, the controlled live matrix, and the
temporary D-30 decision. Native + Current remains the default.

**PR** — https://github.com/immaculatecross/erika/pull/95 · implementation commit
`907fe14ee01abf2fecc69682fa3e2d48ab5a3eb0`.

**Changed**

- The Conversation page now has one collapsed experiment disclosure. Architecture/preset are
  frozen while live and resettable between conversations. `Speak` opens only the explicit turn;
  pauses remain inside it; `Done` is the only commit.
- Native uses the existing ephemeral WebRTC boundary as audio-in/text-out and hands only a valid
  parsed `reply` to the common TTS route. Transcript records one WebM turn, runs STT → Terra,
  visibly labels the fallible transcript, forbids acoustic findings, and uses the same TTS route.
- Added exact prompt builders/hashes, bounded conversation context, strict parse/recovery,
  evidence validation, per-turn diagnostics, Terra/STT/TTS rates and leases, duplicate-call
  guards, live-WebM duration fallback, terminal-SSE handling, and concurrent MP3 pumping.
- Added the 50-cell harness/report, focused route/contract/money/transport tests, D-30, and E-48.
  No E47 lesson-preparation file and no migration was touched.

**Verified**

- Manual Realtime wire: mic tracks are disabled after connect; `Speak` enables them without
  sending a response event; `Done` disables them and sends, in order,
  `{"type":"input_audio_buffer.commit"}` then
  `{"type":"response.create","response":{"output_modalities":["text"]}}`. Text deltas are
  buffered until `response.done`; at most one failed parse sends one further
  `response.create` with text-only repair instructions. The long-lived session config is
  `gpt-realtime-2.1`, `output_modalities:["text"]`, `turn_detection:null`; SDP is authorized by
  the ephemeral client secret, never the real key.
- Live contracts passed: STT is `gpt-4o-transcribe` with `language=it` and JSON response;
  Terra is `gpt-5.6-terra` on `/v1/responses` with
  `reasoning:{"effort":"low"}` and strict `text.format.type:"json_schema"`; common speech is
  `gpt-4o-mini-tts`, `response_format:"mp3"`, `stream_format:"sse"`, with the selected voice.
  The smoke also passed one GA Realtime audio-in/text-out manual turn.
- Every prompt ends in the same exact required-key JSON envelope. Transcript adds exactly:
  “This input is a fallible transcript, not a recording of exactly what the learner certainly
  said. Never report pronunciation, hesitation, pacing, or any acoustic finding; category
  `pronunciation` is forbidden.” Preset-specific text and benchmark hashes:

  | Preset | Exact distinguishing policy | Native SHA-256 | Transcript SHA-256 |
  |---|---|---|---|
  | Record-equivalent | “Use the Record path's policy: identify each genuine error; put every genuine error in `errors`, while the spoken reply still selects at most one.” | `e287a94decd1b4295dc621bd9fab833cd08e014788ef5d6e441b3f00581d192c` | `89292677ad70c839e731ea46d48a472b1297064d68a137e3bf2ef6064306d559` |
  | Minimal | “You are an exact Italian conversation tutor.” plus the shared mistake classes, precision core, empty-is-valid rule and one/two-sentence reply bound; no profile/slips/today context | `500c12e31c7aff23dd7d74b8be516ec4e8862e7a863a21a80aa7099b1949a245` | `2396d16fcbb2a377f043e6d71fdc87e2973b96d7bedfcb035a3a755eef259d3d` |
  | Balanced | “Inspect the whole turn and list every clear error internally; speak the single most useful correction, then continue naturally. Correct speech gets ordinary conversation, not a forced correction.” | `3457958ceea6c49e8956bb1a5f6eb293af384090b3c42f4d084ae79ec8004f5b` | `3db4f80124093e0b88b7245bcad5d929ac4d6a589ea0d1c4513cf0ff3fd72429` |
  | Precision | “A correction requires high confidence. Valid regional or register variants pass. If acoustic uncertainty matters, ask for repetition instead of guessing. There is no quota to find an error.” | `7c1976dcff9204294ab829b58c0688e5219d6db59344b05652d43e47128a83d0` | `2e096d5e9fdb72c76a38ec8c60eb95cd66b3130eab811b9711927bd9060e2c5c` |
  | Current | “Preserve the current tutor's detection and one-correction policy exactly; the structured envelope changes delivery, not judgment.” | `41eb59009508d9a7f32329c114ecabdd19693b9461869fe5660849fe38efd0ac` | `ae18b62296ffd3b49f0465bc4fcf0922fc011a14af00ee0f509a86131dcbc2db` |

  Native mint builds that selected text into the ephemeral session and returns its hash;
  Transcript rebuilds the same selection in the turn route. Focused tests compare the exact
  selected text/hash on both wires, and the benchmark records all ten architecture hashes.
- Money proof: Native reserves one `gpt-realtime-2.1` lease before mint, extends it by heartbeat,
  accumulates response usage, then commits one actual row at end. Transcript reserves and settles
  `gpt-4o-transcribe`, then `gpt-5.6-terra` (including input/cache-write/cache-read/output and
  resolved repair spend), then `gpt-4o-mini-tts` before each provider call. Duplicate `(tutorId,
  seq, leg)` calls are rejected; parse failures remain charged; refusals release/no-call; the
  common TTS settles from returned MP3 bytes. The final disposable browser proof committed
  `$0.01051600` Realtime, `$0.00046500` STT, `$0.01217775` Terra, and `$0.00219265` TTS with
  zero open reservations.
- Controlled benchmark (`docs/research/spike-8-tutor-model-prompt-lab.md`):

  | Architecture | Cells | Parsed | Label catches | False control corrections | First TTS audio | Spend |
  |---|---:|---:|---:|---:|---|---:|
  | Native | 25 | 0 | 0/15 | n/a | unavailable after strict parse rejection | `$0.502749` |
  | Transcript | 25 | 25 | 6/15 | 1/10 | `2.493–6.530 s` | `$0.129179` |

  Fixture synthesis cost `$0.004903`; matrix total `$0.636831`. These synthetic fixtures prove
  plumbing, not spontaneous-learner quality, and no winner was selected.
- Built-browser proof used disposable DB `/tmp/erika-e48-proof.7fq1v4/erika.db`, random port
  `53021`, listener PID `64575`, and served build `Eb1t-MzhWnbs9L0JAjn2K`; its source tree was
  subsequently committed as `907fe14` (the only post-walk change compacted a rates re-export to
  satisfy the 500-line hook). The final clean gate build is `64km_rsmgIL2K0cWAfYjK`.
  It exercised Native once and Transcript twice, proved no request during the deliberate pause,
  inspected transcript/errors/reply/cost/hash, completed two common TTS streams, ended both
  conversations, and linked WAV sessions `c161f364-be74-4397-a169-c5fe000e5a5f` and
  `efc6d583-8f4f-4606-90a7-caa011824dfa`. Transcript's final measured path was capture commit
  `13 ms`, STT `687 ms`, Terra `2,148 ms`, first TTS audio `1,154 ms`, total `7,574 ms`.
  Native first-audio latency is truthfully unavailable: the final proof hit the same strict-JSON
  recovery as the controlled matrix, so no invalid reply was spoken.
- Sequential gates passed: `npm run lint`; `npm run typecheck`; `npm run test`
  (**162 files, 1,522 tests**); `npm run build`; `.mfactory/hooks/run-tripwires.sh --all`.
  Key-gated live smoke passed all four provider contracts after the final transport fixes.

**Tests changed or removed**

- Added `tutor-lab-contract`, `tutor-lab-money`, and `tutor-turn-routes`; expanded manual
  transport, mint, persona, guardrail, money, ffprobe, and live-contract coverage.
- Mutation proof includes no auto-response during a pause, exact commit/create order, exact prompt
  wiring, malformed/fenced/off-schema rejection, transcript pronunciation removal, secret
  boundary, duplicate legs, cap refusal before provider calls, resolved parse charging, live WebM
  packet duration, and terminal speech SSE. No test was removed.

**Live spend**

- Accounted benchmark plus all disposable browser ledgers: `$0.765165`.
- Supplementary key-gated smoke runs and the terminal-SSE probe were not emitted into a local
  ledger; a deliberately conservative `$0.120000` upper bound puts total authorized spend at
  **≤ `$0.885165`**, below the `$1.50` ceiling.

**Risks**

- Native Realtime completed its live audio/text calls but missed the strict JSON boundary in all
  25 matrix cells after one repair. The UI fails truthfully and records no evidence/speech for
  those turns, but Native + Current remains the required default; this is the main merge risk.
- Transcript labels are fallible and cannot support pronunciation/hesitation findings. The matrix
  also showed category drift and one false control correction; real hesitant speech was not used.
- Existing unrelated lint warnings in `lib/analysis/audio-model.ts` and the existing dynamic
  sherpa import build warning remain.
- E47 PR #94 was still OPEN at finalization, so it had not merged and no rebase was applicable.
  `origin/master` remained `5b30adc`; this branch must be rebased and all gates rerun after #94
  resolves, before requesting merge.

**Live verification not performed**

- No real-learner/human judgment, noisy-room input, Safari/iOS run, or subjective voice-quality
  comparison was performed. Native first-audio latency could not be measured because strict
  parsing correctly prevented TTS. Provider-console invoice reconciliation was not available;
  repository modelled/usage-derived rates and the conservative auxiliary bound are reported.

**Blocker** — None to opening/reviewing PR #95. Merge request remains gated on PR #94 resolving,
the required rebase, and a fresh full gate run.

### Rebase note — 2026-07-26 (post E47 merge)

Rebased `feat/e48-tutor-model-prompt-lab` onto `origin/master` at `fcbb86a` (E47 PR #94).

**Conflicts:** `DECISIONS.md` (kept D-29 and D-30) and `FEATURES.md` (kept E-47 + E-48 rows and
v0.8 `E-47 → E-48` scope). No E47 lesson contracts weakened; no E48 lab surface dropped.

**Native JSON:** live probe showed Realtime wrapping valid objects as `({...})`. Added
`unwrapTutorTurnPayload` before the strict schema parse; repair now restates
`TUTOR_OUTPUT_CONTRACT`. Tiny live smoke parsed after the unwrap. Spike 8 amended; Native +
Current remains default.

**Gates after rebase + fix:** `npm run lint` · `npm run build` · `npm run typecheck` ·
`npm run test` (167 files / 1550 tests) · `.mfactory/hooks/run-tripwires.sh --all` — all green.
Ready for Full review on PR #95.
