# Spike 7 — The Realtime voices, in Italian

*Research spike, 2026-07-25. READ-ONLY spike; no product code written, no existing source file
modified. Total live spend: **$0.1833** against a $0.40 ceiling.*

**Provenance discipline.** Every number is **[MEASURED]** (a live call this session — command,
HTTP status and observed value given), **[DOCUMENTED]** (a published figure — URL and retrieval
date), or **[DERIVED]** (computed from the two, both inputs named). Nothing is estimated silently.

> **This spike does not judge voice quality and must never be quoted as if it did.** It cannot
> hear. Choosing a voice from a spec sheet is the exact mistake that caused this whole detour
> (`lib/voice/voices.ts` on `feat/e43-tutor-voice-loop` says so in its own header). The samples in
> §3 exist so the operator's ear can rule. No sentence below describes how any of them sounds.

---

## 0 · The three answers, up front

1. **There are 10 Realtime voices, established from the live API's own validation error** — and
   the operator has never heard any of them in Italian, because **no Realtime voice has ever been
   rendered in this project before today.** spike-5's samples were all `gpt-4o-mini-tts`
   renditions, a *different model*. The suspicion in the brief is structurally confirmed (§1.3).
2. **Native audio-out answers in 1.17 s** on a production-shaped turn — real persona, real learner
   audio, real tool call — against the 4.5–5.0 s of the text-out + TTS path. **Sub-2 s is real**
   [MEASURED, §4].
3. **🚩 But it is NOT cheaper. It is ~2.3× MORE expensive.** A 10-minute conversation on flagship
   audio-out costs **$0.830** against **$0.354** for the same conversation with text-out + TTS on
   identical assumptions [DERIVED, §5]. The brief's premise that going back to audio-out means
   "lower cost" is **wrong**, and it is wrong for the reason D-28 already identified in reverse:
   taking the reply as text is what removed the $64/1M audio-output leg. Putting audio-out back
   puts that leg back, *and* re-feeds the tutor's own audio into the context on every later turn.

**So the trade is latency and simplicity against money, not a clean win.** Which way it goes is a
judgement for the operator, and it is only worth having if a voice in §3 passes the ear test.

---

## 1 · Which voices `gpt-realtime-2.1` actually accepts

### 1.1 How it was established [MEASURED]

Not from a blog post, not from memory, and not from the SDK's type union — from **the live API's
own enum validation**, by minting with a deliberately invalid voice. A rejected mint is HTTP 400
and costs nothing.

```
POST https://api.openai.com/v1/realtime/client_secrets
{"session":{"type":"realtime","model":"gpt-realtime-2.1",
            "audio":{"output":{"voice":"__not_a_voice__"}}}}
→ HTTP 400
{"error":{"message":"Invalid value: '__not_a_voice__'. Supported values are: 'alloy', 'ash',
 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', and 'cedar'.",
 "type":"invalid_request_error","param":"session.audio.output.voice","code":"invalid_value"}}
```

The identical probe against `gpt-realtime-2.1-mini` returned the **same ten** [MEASURED]. So the
voice set does not vary by tier.

**The ten Realtime voices:** `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`,
`verse`, `marin`, `cedar`.

Every one of the ten was then exercised end-to-end (§3), which is a stronger proof than the enum:
all ten produced audio on the first attempt, HTTP 101 → `session.updated` → audio deltas →
`response.done`, no errors.

### 1.2 🚩 The Realtime set is NOT the TTS set — and the product's chosen voice is not in it

spike-5 §2.3 lists **13** voices for `/v1/audio/speech`. The Realtime enum has **10**. The
difference is load-bearing:

| voice | `/v1/audio/speech` (TTS) | Realtime |
|---|---|---|
| `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar` | ✅ | ✅ |
| **`nova`**, **`onyx`**, **`fable`** | ✅ | ❌ **not accepted** |

`lib/voice/voices.ts` on `feat/e43-tutor-voice-loop` offers exactly two voices — the two the
operator picked by ear from spike-5's samples — and **the default is `nova`**:

> `export const DEFAULT_TUTOR_VOICE: TutorVoiceChoice = "female";` … *"The default. **`female`
> (`nova`)**"*

**`nova` cannot be used on Realtime audio-out at all.** So going back to audio-out is not a
transport swap that keeps the voice: it forfeits the operator's default outright. `alloy`, the
operator's other pick, *is* available on Realtime — but as a Realtime rendition, which is a
different model and therefore a different sound, not the one that was approved. `realtime-alloy.mp3`
in §3 is the first time this project has ever produced it.

### 1.3 What the operator's verdict was actually passed on

The verdict recorded in `DECISIONS.md:123` — *"a realtime tutor that listens very well, but does
not speak super well"* — names no voice. The repo carries **one** Realtime voice, ever:

```
lib/tutor/session-config.ts:32   export const TUTOR_VOICE = "marin";
```

`git log -S 'TUTOR_VOICE = '` shows it introduced in **df77777, 2026-07-24** and never changed
[MEASURED]. So the verdict was almost certainly passed on **`marin` and nothing else** — one voice
out of ten. The repo does not explicitly tie the verdict to a voice, so this is an inference from
the only voice that existed, not a record; it is stated as such.

`realtime-marin.mp3` is therefore the control sample: the voice that was judged, rendered the same
way, next to the nine that never got a hearing.

---

## 2 · How the audio was obtained

Not through the TTS endpoint. Through a **real Realtime session**, so what the operator hears is
what native audio-out actually produces.

**The mechanism, worked out from the API rather than assumed:** open the session WebSocket, set
`output_modalities: ["audio"]` with the chosen voice, then drive a single `response.create` whose
`instructions` tell the model to read a supplied sentence verbatim. No audio is ever sent up, so
the session bills text-in plus audio-out only and never accrues an idle audio-input charge.

```
wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1        → HTTP 101
→ session.update  { "type":"realtime", "model":"gpt-realtime-2.1",
                    "output_modalities":["audio"],
                    "instructions": <lettore madrelingua, leggi verbatim>,
                    "audio": { "input":  { "format":{"type":"audio/pcm","rate":24000},
                                           "turn_detection": null },
                               "output": { "voice":"<VOICE>",
                                           "format":{"type":"audio/pcm","rate":24000} } } }
→ session.updated
→ response.create { "response": { "output_modalities":["audio"],
                                  "instructions": "<…>\n\nFrase da leggere:\n<SENTENCE>" } }
→ response.output_audio.delta  × N     (base64 s16le PCM, 24 kHz mono)
→ response.done                        (carries `usage`)
```

Three notes on the contract, all [MEASURED] this session:

- The GA event name is **`response.output_audio.delta`**, not the beta `response.audio.delta`. The
  harness matches `/audio\.delta$/` so either would have been caught; only the GA name arrived.
- **`turn_detection: null` is accepted** and is what stops the session auto-responding when no
  audio is sent.
- `response.create` accepts a per-response `instructions` override, which is why one sentence could
  be spoken without building a conversation item. **All ten transcripts came back byte-identical to
  the requested sentence** — the model added no preamble and no commentary, so the ten samples are
  strictly comparable.

Output is raw PCM, converted with:

```
ffmpeg -f s16le -ar 24000 -ac 1 -i raw-<voice>.pcm -codec:a libmp3lame -b:a 128k realtime-<voice>.mp3
```

Harness: `…/scratchpad/spike-7/` — `say.js` (one sample per voice), `turn.js` (the §4
production-shaped turn), `run.sh`, `cost.js`, `results.jsonl`, `turn-results.jsonl`. Requires `ws`
(borrowed from spike-6's scratchpad, not installed into the repo) and system `ffmpeg`/`ffprobe`.

---

## 3 · 🎧 The samples — LISTEN TO THESE

All ten speak the **same** sentence, on the **same** model (`gpt-realtime-2.1`), through the
**same** mechanism, so the only variable is the voice:

> *"Gli sbagli che ripeti ogni giorno sono quelli che nessuno ha più il coraggio di correggerti."*

This is deliberately the sentence spike-5 §2.2 used, so these can be compared directly against the
`gpt-4o-mini-tts` samples the operator already ruled on
(`artifacts/voice-samples/tts-*.mp3`, same directory).

All in **`/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/`**
(gitignored — `git check-ignore` confirms `.gitignore:19`):

| # | file (absolute path) | duration [MEASURED, ffprobe] | TTFB [MEASURED] | size |
|---|---|---|---|---|
| 1 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-alloy.mp3` | 6.600 s | 968 ms | 106 028 B |
| 2 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-ash.mp3` | 7.056 s | 1 015 ms | 113 324 B |
| 3 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-ballad.mp3` | 7.320 s | 868 ms | 117 548 B |
| 4 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-cedar.mp3` | 5.712 s | 845 ms | 91 820 B |
| 5 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-coral.mp3` | 6.648 s | 738 ms | 106 796 B |
| 6 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-echo.mp3` | 7.416 s | 934 ms | 119 084 B |
| 7 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-marin.mp3` | 5.904 s | 777 ms | 94 892 B |
| 8 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-sage.mp3` | 8.208 s | 1 413 ms | 131 756 B |
| 9 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-shimmer.mp3` | 7.416 s | 962 ms | 119 084 B |
| 10 | `/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-verse.mp3` | 7.968 s | 900 ms | 127 916 B |

All mp3, 24 kHz mono, 128 kbps [MEASURED, `ffprobe -show_entries stream=sample_rate,channels`].

**Where to start.** `realtime-marin.mp3` is the voice the tutor already shipped with and almost
certainly the one that drew *"does not speak super well"* (§1.3) — play it first as the baseline,
then the other nine against it. `realtime-cedar.mp3` and `realtime-marin.mp3` are the two newest
voices the brief singles out. `realtime-alloy.mp3` is the only overlap with the operator's own
spike-5 picks, and hearing it as a *Realtime* rendition beside
`tts-gpt4o-mini-tts-alloy-instructed.mp3` is the cleanest same-voice / different-model A/B
available.

**Speaking-rate spread is large and it is a real variable** [MEASURED]: the same 92 characters run
from **5.712 s (cedar)** to **8.208 s (sage)** — a **1.44× spread**, which is both a pacing choice
and a cost multiplier, since audio-out is billed by the token and tokens track duration (§5).

### 3.1 A bonus sample, clearly NOT part of the comparison set

`/Users/mattiamauro/Desktop/Murder she wrote/Erika/artifacts/voice-samples/realtime-live-turn-marin.mp3`
(5.952 s) is **not** the fixed sentence. It is the tutor's own spoken reply from run 2 of the §4
production-shaped turn — the real persona, reacting to a real learner error, spoken natively. It is
included because it is the only artifact here that shows what an actual audio-out tutor turn sounds
like. **Do not include it in the voice comparison**; it is a different sentence.

> One honest observation from that run, reported as behaviour and not as quality: on all three
> turns the model called `log_evidence` **and** spoke a filler line while doing so
> (*"Un momento, ti rispondo con una piccola correzione e poi continuo."*). That is the narration
> the e43 commit `0687ad5 fix(e43): … the tutor stops narrating` was written to suppress on the
> text path. On audio-out it would need suppressing again, in the persona.

---

## 4 · Time to first audio byte — the number that decides sub-2 s

### 4.1 How it was measured, and what is excluded

`t0` is the instant the request is **committed** on an already-open socket; `t1` is the arrival of
the **first audio delta**. Two shapes were measured.

**Excluded from both, and it matters:** the WebSocket handshake (588–2 514 ms [MEASURED]) is not
counted, because in a live call the socket is already open — this is the same reasoning spike-6
§5.1 used. **Also excluded:** server VAD's `silence_duration_ms`, observed at **500 ms** default in
spike-6 §0, which in a live call sits *before* t0. A learner-silence-to-first-audio figure is
therefore TTFB + ~500 ms.

### 4.2 The production-shaped turn [MEASURED, n=3]

This is the number to quote. It uses this repo's own `buildTutorPersona` output (**8 010 chars =
2 210 input text tokens**, generated by running the real builder through `tsx`), the `log_evidence`
tool declared exactly as `session-config.ts` declares it, and spike-6's **G1.wav** fixture as the
learner turn (5.15 s, *"Ieri ho andato al cinema…"* — the planted auxiliary error). Audio was
uploaded in 40 ms frames, then `input_audio_buffer.commit` + `response.create`, with t0 at the
commit.

| run | TTFB | reply audio | `log_evidence` calls | input tokens | output tokens |
|---|---|---|---|---|---|
| 1 | **1 156 ms** | 4.45 s | 1 | 2 261 (2 210 text + 51 audio) | 393 (304 text + 89 audio) |
| 2 | **1 168 ms** | 5.90 s | 1 | 2 261 | 281 (163 text + 118 audio) |
| 3 | **1 407 ms** | 3.75 s | 1 | 2 261 | 282 (207 text + 75 audio) |

**Median 1.168 s; range 1.156–1.407 s.**

| path | learner falls silent → first audio |
|---|---|
| **Native audio-out (this spike)** | **≈ 1.17 s** measured, **≈ 1.67 s** including the 500 ms VAD window |
| Text-out + TTS (what E-43 built) | **4.5–5.0 s** (the operator's figure from real use) |
| Text-out + TTS (spike-6 §1 projection) | ≈ 2.43 s |

**Sub-2 s is real.** Native audio-out is ~4× faster than the shipped text-out path even after the
VAD window is added back, and it beats even spike-6's *optimistic projection* for text-out by a
full second. The `log_evidence` tool fired on **every** turn, so the evidence contract survives
audio-out intact — that was not assumed, it was measured.

### 4.3 The read-a-sentence shape [MEASURED, n=10]

The §3 samples, with only a 98-token instruction and no conversation: TTFB **738 ms min / 934 ms
median / 1 413 ms max**. Close to the production-shaped figure, which says the 2 210-token persona
prefill is **not** what dominates this latency.

**Two caveats, stated rather than rounded away.** (a) Every run here was turn *one* of a cold
session with no accumulated history; spike-6 §5.5 shows context growing every turn, and a
20th-turn prefill will be larger than a 1st-turn one, even at 96% cache. (b) n=3 and n=10, single
region, single client, one afternoon. **1.17 s is a floor, not a promise** — but the gap to 4.5 s
is far too wide for that caveat to close it.

---

## 5 · Cost — and this is where the case for audio-out breaks

### 5.1 Unit rates [DOCUMENTED], retrieved 2026-07-25

From `developers.openai.com/api/docs/pricing` and `developers.openai.com/api/docs/models/gpt-realtime-2.1`
(both fetched successfully this session — note spike-6 §5.4 recorded these hosts as 403-ing from
this sandbox; they did not today). Per 1M tokens:

| model | text in | cached text | text out | audio in | cached audio | **audio out** |
|---|---|---|---|---|---|---|
| `gpt-realtime-2.1` | $4.00 | $0.40 | $24.00 | $32.00 | $0.40 | **$64.00** |
| `gpt-realtime-2.1-mini` | $0.60 | $0.06 | $2.40 | $10.00 | $0.30 | **$20.00** |

### 5.2 Audio-output token throughput [MEASURED — new in this spike]

Across the ten §3 samples: **1 393 audio-output tokens for 69.65 s of speech = 20.00 tokens/second
= 1 200 per audio-minute** (per-voice spread 19.2–20.1 tok/s — remarkably tight; the *duration*
varies by voice, the tokens-per-second does not).

This is the first time this repo has measured the audio-**output** side against real `usage`; spike-6
measured only the input side (628/audio-minute).

### 5.3 A 10-minute conversation [DERIVED]

Modelled on spike-6 §5.4's assumptions wherever spike-6 fixed one — 20 turns, 5 min learner audio
at the measured 628 tokens/min, TTS at the documented $0.015/audio-min — plus this spike's own
measurements: persona 2 210 tokens, 225 text-output tokens/turn (the measured mean of runs 1–3,
reasoning included), audio-out at the measured 1 200 tokens/min, and spike-6 §5.5's measured 96%+
prompt-cache behaviour. Both paths are computed by the **same** function
(`…/scratchpad/spike-7/cost.js`) so the only difference is the output modality.

| path | input | text out | **audio out** | TTS | **total / 10 min** |
|---|---|---|---|---|---|
| **audio-out, `gpt-realtime-2.1`** | $0.3398 | $0.1080 | **$0.3818** | — | **$0.830** |
| text-out + TTS, `gpt-realtime-2.1` | $0.1705 | $0.1080 | — | $0.0750 | **$0.354** |
| **audio-out, `gpt-realtime-2.1-mini`** | $0.0968 | $0.0108 | **$0.1193** | — | **$0.227** |
| text-out + TTS, `gpt-realtime-2.1-mini` | $0.0419 | $0.0108 | — | $0.0750 | **$0.128** |

**Against the $0.283 baseline.** This model puts text-out + TTS at $0.354 where spike-6 measured
$0.283 — the gap is honest and explained: this spike uses the *real* 2 210-token product persona
where spike-6 used a 1 663-token listening prompt, and 225 measured text-output tokens/turn where
spike-6 assumed ~120. What survives that difference is the **ratio**, because both columns share
every assumption:

> **Native audio-out costs 2.34× the text-out + TTS path.**
> Applied to spike-6's measured baseline: **$0.283 → ≈ $0.66 per 10-minute conversation.**
> Stated on this spike's own consistent assumptions: **$0.354 → $0.830.**

**Why**, in two terms, both unavoidable:

1. **The $64/1M output leg comes back.** 5 minutes of tutor speech = 6 000 audio-output tokens =
   **$0.382**, replacing $0.075 of TTS. That single line is +$0.31.
2. **The tutor's own audio re-enters the context.** With text-out, a reply costs ~225 text tokens
   in the next turn's prompt; with audio-out it costs ~300 *audio* tokens, and audio input is
   $32/1M against text's $4/1M. Over 20 turns that roughly doubles the input leg
   ($0.170 → $0.340).

D-28 got this exactly right in reverse: *"taking the reply as text removes the $64/1M audio-output
leg, which was the bulk of realtime's cost."* Undoing that decision restores that cost. **Cost is
an argument against going back to audio-out, not for it.**

**A cheaper door that this spike did not open:** `gpt-realtime-2.1-mini` on audio-out is
**$0.227** — below the $0.283 baseline. But spike-6 §1.6 disqualified mini as a *listening* leg
(3 of 9 replies empty, 2 hallucinated errors on correct speech). Whether a **flagship-listens /
mini-speaks** split is even expressible in one Realtime session was **not tested here** and should
not be assumed; both tiers accept the same ten voices (§1.1), which is the only relevant fact this
spike established.

### 5.4 🚩 `lib/analysis/rates.ts` against what was found

Checked as instructed, on `master`:

| what `rates.ts` says | published / measured | verdict |
|---|---|---|
| flagship audio in $32/1M, cached $0.40/1M, out $64/1M | identical | ✅ **correct** |
| mini audio in $10/1M, cached $0.30/1M, out $20/1M | identical | ✅ **correct** |
| **`RealtimeModelRate` has NO text-token fields at all** | text in $4.00, cached $0.40, **out $24.00** per 1M (flagship) | 🚩 **absent — the unsafe shape** |
| `realtimeAudioTokensPerMinute` = 1 500 out/min | **1 200/min MEASURED** (§5.2) | over-books 1.25× — safe, but thinner than the comment claims |
| `realtimeAudioTokensPerMinute` = 1 500 in/min | 628/min (spike-6 MEASURED) | over-books 2.4× — safe |

**No rate in `rates.ts` sits below the published price.** The defect is a *missing leg*, not a low
number: `realtimePerMinuteUsd` prices text at **$0**, and a real turn measured here carries 2 210
text-input and 163–304 text-output tokens — **$0.108 of text output alone** over a 10-minute
conversation on flagship, ledgered as free. That is the one direction the file's own doctrine
forbids.

It is masked, for now, by the audio over-book: `realtimeSessionCost(flagship, 10)` = **$1.440**
against this spike's modelled **$0.830** for audio-out, so the *aggregate* still over-books ~1.7×
(and ~2.0× for mini: $0.450 vs $0.227). Safe in total, for the wrong reason.

**This is not a new finding and it is already fixed on the branch.** spike-6 §5.6 flagged it, and
`lib/analysis/rates-realtime.ts` on `feat/e43-tutor-voice-loop` carries
`usdPerTextInputToken` / `usdPerCachedTextInputToken` / `usdPerTextOutputToken` at exactly the
published $4.00 / $0.40 / $24.00 [verified by `git show`]. Anything that revives audio-out must
keep that file, and add an audio-**output** term to it — which the text-out design deliberately
does not need.

---

## 6 · What going back to audio-out would cost and save, architecturally

Read from `feat/e43-tutor-voice-loop` via `git show`. The branch is **47 files, +4 445 / −352**.

### 6.1 What becomes unnecessary — the speaking leg, entire

| file (on `feat/e43-tutor-voice-loop`) | lines | what it exists to do |
|---|---|---|
| `lib/voice/speech.ts` | 110 | the `TextToSpeech` vendor seam |
| `lib/voice/openai-speech.ts` | 183 | the OpenAI SSE TTS implementation |
| `lib/voice/voices.ts` | 56 | the two-voice operator mapping — **and its default `nova` is not a Realtime voice at all** (§1.2) |
| `lib/tutor/speak.ts` | 147 | `POST /api/tutor/speak`: the second secret boundary, reserve-before-call, settle-on-resolve, `MAX_SPEAK_CHARS` runaway guard |
| `app/api/tutor/speak/route.ts` | 11 | the route shell |
| `lib/tutor/speech-queue.ts` | 99 | pipelined synthesis, serial playback, barge-in cancellation |
| `lib/tutor/reply-stream.ts` | 112 | the sentence-boundary chunker and `MIN_SPEAKABLE_CHARS` |
| **≈ 718 lines of product code** | | plus `tests/tutor-speak-route.test.ts` (248) and `tests/tutor-reply-stream.test.ts` (212) |

**≈ 1 180 lines of code and tests, and with them four whole concepts:** a second vendor seam, a
second per-leg money reservation on the ledger, a sentence-boundary heuristic, and a client-side
audio queue with its own ordering and barge-in rules. Native audio-out has none of them — the model
speaks on the connection that is already open, the interruption is already handled by
`interrupt_response`, and there is no chunk boundary because there are no chunks.

The three latency sources named in the brief map one-to-one onto three of those files:
**sentence-boundary wait** is `reply-stream.ts`, **second network round trip** is `speak.ts` +
`openai-speech.ts`, **clip buffering** is `speech-queue.ts`. Deleting them is exactly how the 4.5 s
becomes 1.17 s. That is not a coincidence; it is the same fact stated twice.

Also simplified rather than deleted: `app/practice/tutor/page.tsx` (+234 on the branch, much of it
wiring the queue), `lib/tutor/realtime-client.ts` (+67, the text-delta data-channel handling), and
`lib/analysis/budget.ts` / `lib/tutor/money.ts`, which grew a second reservation path.

### 6.2 What it would cost

- **~2.34× the money** (§5.3). This is the real price and it is not small.
- **The operator's chosen default voice is gone** (§1.2). `nova` does not exist on Realtime.
  Whichever of the ten wins in §3 is a *fresh* decision, not a carry-over.
- **`instructions` steering is lost.** spike-5 §2.3 established that `gpt-4o-mini-tts` accepts an
  `instructions` string controlling accent, intonation and pace, and §2.2 **measured** it working
  (same voice, same text, 7.056 s instructed vs 7.752 s plain). spike-5 called it *"the steering
  channel Realtime never gave us and the direct answer to 'it does not speak super well'."* The
  Realtime session object has `audio.output.voice` and `speed` — **no per-utterance delivery
  steering**. If a Realtime voice is merely *acceptable* rather than good, there is no dial to
  improve it with; the text path has one and it is measured to work.
- **The narration reappears** (§3.1) and must be suppressed in the persona again.
- **The vendor seam goes.** `lib/voice/speech.ts` was built so Cartesia could replace OpenAI later
  (spike-5 §6). Audio-out welds the voice to OpenAI's Realtime session permanently. That is the
  *"one fewer vendor leg"* the brief counts as a saving, and it is the same fact as losing the
  escape hatch.

### 6.3 What it would save

- **1.17 s instead of 4.5–5.0 s** [MEASURED, §4.2] — the largest single UX improvement available
  anywhere in this product right now.
- **≈ 1 180 lines and four concepts deleted** (§6.1), which is squarely what D-26 asks for.
- One vendor leg, one secret boundary, one money-reservation path fewer.
- The listening leg, the persona, the `log_evidence` validated-id contract and the ephemeral mint
  are **untouched** — audio-out changes `output_modalities` from `["text"]` to `["audio"]` and
  nothing else about how the tutor hears. The tool call fired on all three measured turns (§4.2),
  so D-28's core win survives the change intact.

### 6.4 The decision this spike hands over, and the one it refuses

**Refused:** which voice, or whether any of them is good enough. That is §3's job and the
operator's ear.

**Handed over, as a conditional:** *if* one of the ten in §3 passes, the trade is **1.17 s and
−1 180 lines against +2.34× cost**. If none passes, nothing here changes anything and E-43 stands
as built — the samples cost $0.18 to find that out. The one framing the evidence does **not**
support is the brief's own: going back to audio-out is not *"lower cost"*. It is a latency and
simplicity win bought with money.

---

## 7 · Spend

**$0.1833 total**, against the $0.40 ceiling — computed from the real `usage` object returned on
every one of the 14 billed calls, at the §5.1 published rates (`…/scratchpad/spike-7/cost.js`):

| what | calls | USD |
|---|---|---|
| voice-enum probes (HTTP 400) | 2 | $0.0000 |
| dry run (marin) | 1 | $0.0098 |
| the ten §3 samples | 10 | $0.1079 |
| the three §4 production-shaped turns | 3 | $0.0656 |
| **TOTAL** | **16** | **$0.1833** |

No 5xx, no rate limit; every call returned first time. Nothing was written to `data/`. No product
code was written and no existing file was modified.

---

## Sources

- **Voice enum:** the live API's own `invalid_value` error on
  `POST https://api.openai.com/v1/realtime/client_secrets`, both tiers [MEASURED 2026-07-25].
- **Prices:** `https://developers.openai.com/api/docs/pricing` and
  `https://developers.openai.com/api/docs/models/gpt-realtime-2.1` [DOCUMENTED, retrieved
  2026-07-25, two independent pages agreeing on all six rates and agreeing with `rates.ts`'s
  audio figures].
- **In-repo:** `lib/tutor/session-config.ts`, `lib/tutor/mint.ts`, `lib/tutor/persona.ts`,
  `lib/analysis/rates.ts`; `feat/e43-tutor-voice-loop`'s `lib/voice/*`, `lib/tutor/speak.ts`,
  `lib/tutor/speech-queue.ts`, `lib/tutor/reply-stream.ts`, `lib/analysis/rates-realtime.ts`;
  `docs/research/spike-5-voice-loop.md` §2/§4/§5, `docs/research/spike-6-tutor-listening.md`
  §0/§5.1/§5.4/§5.5/§5.6; `DECISIONS.md` D-3, D-26, D-28.
- **Fixture reused:** spike-6's `G1.wav` (5.15 s), from that spike's scratchpad.

## Appendix — reproducing this

```
cd "/Users/mattiamauro/Desktop/Murder she wrote/Erika" && set -a && . ./.env.local && set +a
S=…/scratchpad/spike-7
bash  $S/run.sh                                    # ten samples + mp3 conversion   (~$0.11)
node  $S/turn.js …/spike-6/audio/G1.wav out.pcm    # one production-shaped turn     (~$0.02)
node  $S/cost.js                                   # spend + the 10-minute model    ($0)
```

`persona.txt` is regenerated from the repo's own builder with
`node_modules/.bin/tsx $S/gen-persona.ts`. `ws` is borrowed from spike-6's scratchpad and is not
installed into the repo.

**The perishable artifact is `artifacts/voice-samples/realtime-*.mp3`.** The scratchpad is
session-scoped; the sample directory is not, but it *is* gitignored, so nothing here survives a
fresh clone. If these ten renditions are ever wanted again they cost $0.11 to remake.
