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
