# Spike 5 — The turn-based voice loop (STT → LLM → TTS)

*Research spike, 2026-07-25. READ-ONLY spike; no product code written, no existing source file modified.*

**Provenance discipline.** Every number is tagged **[MEASURED]** (a live call made this session —
command, HTTP status and observed value given), **[DOCUMENTED]** (a published figure — URL and
retrieval date given), or **[DERIVED]** (computed from the two, both inputs named). Nothing is
estimated silently. This project has shipped a production bug from a mocked contract, so an
unverified claim is marked unverified rather than rounded into confidence.

> **Outage note.** OpenAI was in an active incident ("Elevated error rates", *Investigating*,
> affecting APIs/ChatGPT/Codex — status.openai.com [MEASURED 09:40 UTC]) for the first ~10 minutes
> of this spike. Every call from 09:34 to 09:44 returned 500/503. **The API recovered at 09:44:44
> UTC [MEASURED]** and the full harness then ran clean. All results below are from the healthy
> window (09:45–09:47 UTC) unless stated. Two consequences worth keeping: the failure mode is a
> generic `server_error` with a request id (not an auth or shape error), and recovery was *flaky* —
> the first post-recovery batch still had legs returning 500 while others returned 200. **The loop
> must treat 5xx on any leg as normal and retry with backoff**; `retryOnRateLimit` in
> `lib/analysis/audio-model.ts:341` already has the right shape but only catches 429.

## Question

The Realtime-over-WebRTC tutor (`lib/tutor/`) listens well but speaks poor Italian, so it is being
replaced by a turn-based STT → LLM → TTS loop, OpenAI first, with a vendor seam for Cartesia later.
That decision is settled and is not relitigated. This spike grounds the *implementation* in
measured facts: which models this key reaches, what the TTS sounds like in Italian, the real word
error rate, the real per-turn wall-clock, the real cost, and the seam's interface pair.

## Headline findings

1. **A blocking turn is 4.63 s — too slow.** [MEASURED] But TTS full synthesis is 2.4 s of that,
   and SSE streaming cuts time-to-first-audio to 0.84 s ⇒ **~2.9 s perceived**. Streaming is not an
   optimization here, it is the difference between "sluggish" and "alive".
2. **STT is a solved problem: 0.00% WER on every model, even on degraded audio.** [MEASURED]
   This removes STT quality as a decision axis and makes it purely a cost/latency choice.
3. **`lib/analysis/rates.ts` under-prices TTS by ~1.5×** — the unsafe direction, now confirmed with
   measured audio durations (§5.3). Second independent finding of this bug.
4. **The loop costs ~$0.10 per 10-minute conversation** — ~4.5× cheaper than realtime-mini.

---

## 1 · Model availability [MEASURED]

```
curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"
→ HTTP 200, 123 models total
```

Speech/audio models **actually available to this key** — this is the production key, so this list
is authoritative:

| Model id | Present |
|---|---|
| `gpt-4o-mini-tts`, `gpt-4o-mini-tts-2025-03-20`, `gpt-4o-mini-tts-2025-12-15` | ✅ |
| `tts-1`, `tts-1-1106`, `tts-1-hd`, `tts-1-hd-1106` | ✅ |
| `gpt-4o-transcribe`, **`gpt-4o-transcribe-diarize`** | ✅ |
| `gpt-4o-mini-transcribe`, `-2025-03-20`, `-2025-12-15` | ✅ |
| `whisper-1` | ✅ |
| `gpt-audio`, `gpt-audio-1.5`, `gpt-audio-mini` (+ snapshots) | ✅ |
| `gpt-realtime`, `-1.5`, `-2`, `-2.1`, `-2.1-mini`, `-mini`, `-translate`, `-whisper` | ✅ |

Every model the loop needs exists. Two notes:

- **`gpt-4o-transcribe-diarize` is present and was not on our radar.** If the tutor ever needs to
  separate learner speech from tutor playback bleed on an open mic, this is a first-party option
  worth a look — it may overlap with what `lib/speaker/` does locally. Not evaluated here.
- **`gpt-4o-mini-tts` has a `-2025-12-15` snapshot.** Pin the snapshot in product code rather than
  the floating alias, per the repo's habit of pinning.

---

## 2 · TTS contract and Italian samples

### 2.1 The exact request that worked [MEASURED]

`POST https://api.openai.com/v1/audio/speech` → **HTTP 200**, raw mp3 bytes:

```json
{
  "model": "gpt-4o-mini-tts",
  "voice": "coral",
  "input": "Gli sbagli che ripeti ogni giorno sono quelli che nessuno ha più il coraggio di correggerti.",
  "response_format": "mp3",
  "instructions": "Parla come una madrelingua italiana colta: calma, precisa, calorosa, ritmo naturale."
}
```

Output is **mp3, 24 kHz, mono** [MEASURED via ffprobe]. The response is raw audio with **no `usage`
object** — cost must be derived from duration, which is exactly what breaks `rates.ts` (§5.3).

### 2.2 🎧 The samples — LISTEN TO THESE

All 7 synthesize the *same* sentence. Full paths, all in
`/private/tmp/claude-501/-Users-mattiamauro-Desktop-Murder-she-wrote-Erika/347ee7fd-6093-43a9-aa44-af69592ad2c0/scratchpad/spike-voice/`:

| File | Model | Voice | `instructions` | HTTP | Latency | Duration | Size |
|---|---|---|---|---|---|---|---|
| `tts-gpt4o-mini-tts-alloy-plain.mp3` | gpt-4o-mini-tts | alloy | — | 200 | 2.549 s | 7.752 s | 124 032 B |
| `tts-gpt4o-mini-tts-alloy-instructed.mp3` | gpt-4o-mini-tts | alloy | ✅ | 200 | 1.614 s | 7.056 s | 112 896 B |
| `tts-gpt4o-mini-tts-coral-instructed.mp3` | gpt-4o-mini-tts | coral | ✅ | 200 | 1.835 s | 7.656 s | 122 496 B |
| `tts-gpt4o-mini-tts-marin-instructed.mp3` | gpt-4o-mini-tts | marin | ✅ | 200 | 1.332 s | 5.448 s | 87 168 B |
| `tts-gpt4o-mini-tts-nova-plain.mp3` | gpt-4o-mini-tts | nova | — | 200 | 3.359 s | 6.120 s | 97 920 B |
| `tts-tts1-alloy.mp3` | tts-1 | alloy | n/a | 200 | 2.418 s | 5.760 s | 115 200 B |
| `tts-tts1hd-alloy.mp3` | tts-1-hd | alloy | n/a | 200 | 3.037 s | 5.064 s | 101 280 B |

> **The A/B to listen to first** is `alloy-plain` vs `alloy-instructed` — same model, same voice,
> only the `instructions` string differs. The instructed take renders the same 92 characters in
> **7.056 s vs 7.752 s**, i.e. **9% faster-spoken** [MEASURED]. So `instructions` demonstrably
> reaches the audio; it is not a no-op. Whether it steers Italian *well* is the operator's ear to
> judge — that judgment cannot be delegated to a spec sheet, and it is why these files exist.
>
> **Speaking-rate spread across voices is large** [MEASURED]: the same 92 characters run from
> **5.448 s (marin)** to **7.752 s (alloy plain)** — a **1.42× spread**. That is a real UX variable
> (and a real cost variable, §5.3), not a cosmetic one.

### 2.3 Documented parameter contract

[DOCUMENTED], `developers.openai.com`, retrieved 2026-07-25:

- **Voices (13):** `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`,
  `shimmer`, `verse`, `marin`, `cedar`. `tts-1`/`tts-1-hd` support a subset **excluding** `ballad`,
  `verse`, `marin`, `cedar`.
- **`instructions`:** `gpt-4o-mini-tts` **only** — controls "accent, emotional range, intonation,
  impressions, speed of speech, tone, whispering". This is the steering channel Realtime never gave
  us and the direct answer to "it does not speak super well".
- **`response_format`:** mp3, opus, aac, flac, wav, pcm. **`speed`:** 0.25–4.0.
- **`stream_format`:** `sse` | `audio`; **`sse` on `gpt-4o-mini-tts` only**, not on tts-1/tts-1-hd.

---

## 3 · STT accuracy on Italian [MEASURED]

Ground truth is the 16-word reference sentence. WER is exact Levenshtein over accent-preserving
word tokens (`wer.py`; accents deliberately **not** stripped, so `più → piu` would count as an
error — it is one, for a language coach). The instrument was self-tested offline against a
hypothesis with 2 substitutions + 1 deletion and correctly returned `WER=18.75% S=2 D=1 I=0 N=16`.

Input: `tts-gpt4o-mini-tts-coral-instructed.mp3` (7.656 s of clean studio Italian).

| Model | HTTP | Latency | **WER** | Transcript |
|---|---|---|---|---|
| `whisper-1` | 200 | 1.610 s | **0.00%** | exact |
| `gpt-4o-transcribe` | 200 | 0.919 s | **0.00%** | exact |
| `gpt-4o-mini-transcribe` | 200 | 0.990 s | **0.00%** | exact (adds two commas) |

### Degraded input [MEASURED]

Real learner mics are not studio audio, so the sample was re-encoded to **8 kHz mono, 16 kbps, with
`atempo=1.15`** (telephone-grade, slightly sped up) via ffmpeg — 13 940 B, 6.840 s.

| Model | HTTP | Latency | **WER** |
|---|---|---|---|
| `whisper-1` | 200 | 1.728 s | **0.00%** |
| `gpt-4o-transcribe` | 200 | 0.944 s | **0.00%** |
| `gpt-4o-mini-transcribe` | 200 | 0.862 s | **0.00%** |

**All three models transcribed perfectly even at telephone quality.** STT is not the weak link and
should not be agonized over.

> **Honest caveat on this result.** 0.00% across the board on one 16-word sentence means the test
> was **too easy to discriminate** between the models. TTS output is unnaturally clean speech —
> no disfluency, no accent, no hesitation, no background noise, and no *learner errors*. A real
> A2 learner's halting, accented Italian is a materially harder input, and this spike has **not**
> measured that. What is established: none of these models has a baseline Italian problem. What is
> **not** established: their relative accuracy on non-native speech, which is the case that
> actually matters. Re-measure with real learner audio before treating the model choice as final.

### Timestamps — a contract trap, confirmed live [MEASURED]

| Model | `verbose_json` | Result |
|---|---|---|
| `whisper-1` | ✅ 200 | returns `duration: 7.65`, `language: "italian"`, and a `segments[]` array with `start`/`end` |
| `gpt-4o-transcribe` | ❌ **400** | `"response_format 'verbose_json' is not compatible with model 'gpt-4o-transcribe-api-ev3'. Use 'json' or 'text' instead."` |

**Asking a GPT-4o transcribe model for timestamps is a hard 400, not a silent downgrade.** Any code
that requests timestamps generically across models will break. Timestamps are a `whisper-1`-only
capability — which is why `segments` is **optional** in the seam (§6). Note also the error leaks the
real backing model id, `gpt-4o-transcribe-api-ev3`.

---

## 4 · Latency — the number that decides the design [MEASURED]

Full simulated turn, 3 runs: STT(7.656 s audio) → `gpt-4.1-mini` (~40-token Italian tutor reply) →
TTS(that reply). Each leg timed with `curl -w "%{time_total}"`, total wall-clock wrapped in python.

| Leg | p50 | Range |
|---|---|---|
| STT (`gpt-4o-transcribe`) | **1.026 s** | 0.907 – 1.171 s |
| LLM (`gpt-4.1-mini`, 60 prompt / 29–44 completion tokens) | **1.037 s** | 0.876 – 1.253 s |
| TTS (`gpt-4o-mini-tts`, full synthesis) | **2.415 s** | 2.192 – 2.419 s |
| **TOTAL (blocking)** | **4.626 s** | 4.522 – 4.631 s |

### Verdict, plainly

**A naive blocking turn lands at ~4.6 s — WORSE than the 2–4 s band, and far from 2 s.** Shipping
the loop that way would trade Realtime's bad *voice* for bad *pacing*.

### Streaming is available and it is the fix [MEASURED]

`stream_format: "sse"` on `gpt-4o-mini-tts` → **HTTP 200**, `time_starttransfer` = **0.844 s**
(and 0.583 s on an earlier call), total 1.756 s. The stream is SSE events carrying base64 audio:

```
data: {"type":"speech.audio.delta","audio":"//PExABZbDmcAOYe3D/L9M6N40..."}
```

| Turn shape | Time to first audio |
|---|---|
| Blocking (wait for full mp3) | **4.63 s** |
| **Streaming TTS** (STT p50 + LLM p50 + TTFA) | **≈ 2.91 s** |

**Streaming moves the loop from ~4.6 s into the 2–4 s band.** It is not a nice-to-have; it is the
difference between a tutor that feels sluggish and one that feels alive. **Design the loop to
stream from day one.**

> **Two caveats that push the real number up.** (a) The LLM leg was measured with a *60-token*
> prompt; a real turn carries the persona from `lib/tutor/persona.ts` plus conversation history —
> several hundred to a few thousand tokens — so the LLM leg will be slower than 1.037 s. (b) These
> are single-region, single-client measurements taken minutes after an incident. **~2.9 s is a
> floor, not a promise.** Further cuts available if needed: stream the LLM too and begin TTS on the
> first sentence rather than the full reply, which would overlap the LLM and TTS legs almost
> entirely.

---

## 5 · Cost

### 5.1 Unit prices [DOCUMENTED], retrieved 2026-07-25

| Leg | Model | Price |
|---|---|---|
| TTS | `gpt-4o-mini-tts` | **$0.60/1M text-in + $12.00/1M audio-out tokens** ≈ **$0.015/min** |
| TTS | `tts-1` / `tts-1-hd` | **$15 / $30 per 1M characters** (genuinely per-character) |
| STT | `whisper-1` | $0.006 / audio-minute |
| STT | `gpt-4o-transcribe` | $0.006 / audio-minute (token form: $2.50/1M audio-in, $10/1M text-out) |
| STT | `gpt-4o-mini-transcribe` | $0.003 / audio-minute |
| LLM | `gpt-4.1-mini` (repo's `TEXT_MODEL`) | $0.40/1M in, $1.60/1M out |

**Measured token throughput** [MEASURED, from real `usage`]: the STT leg reported
`input_tokens: 76` (all audio) + `output_tokens: 25–27` for 7.656 s of audio ⇒ **≈ 9.93 audio
tokens/second ≈ 596/min**. Costed in token form that is ~$0.018 per 5 min, *below* the $0.006/min
per-minute rate ($0.030) — so **the per-minute rate is the conservative one** and is what the
tables below use.

### 5.2 A 10-minute conversation, ~50/50 split [DERIVED]

5 min learner audio → STT; ~20 turns → LLM; 5 min tutor speech → TTS.

| Leg | Choice | USD |
|---|---|---|
| STT | `gpt-4o-transcribe` (5 × $0.006) | 0.0300 |
| LLM | `gpt-4.1-mini`, 20 turns @ ~800 prompt / 40 completion | 0.0077 |
| TTS | `gpt-4o-mini-tts` (5 × $0.015) | 0.0750 |
| **Total** | | **$0.113** |

With `gpt-4o-mini-transcribe` instead: **$0.098**.

**Against the Realtime path it replaces**, as `rates.ts` models it today [DERIVED from
`realtimePerMinuteUsd`, 1500 in + 1500 out tokens/min]:

| Path | Per 10-min conversation |
|---|---|
| **Turn-based loop (this spike)** | **≈ $0.10** |
| `gpt-realtime-2.1-mini` | $0.45 |
| `gpt-realtime-2.1` (flagship) | $1.44 |

**~4.5× cheaper than realtime-mini, ~14× cheaper than flagship.** Quality and cost point the same
way. **TTS is ~76% of the loop's cost**, so TTS — not STT — is the cost lever.

### 5.3 🚩 `lib/analysis/rates.ts` under-prices TTS — the unsafe direction

`rates.ts:138`:

```ts
export const TTS_RATES: Record<TtsModelId, TtsModelRate> = {
  "gpt-4o-mini-tts": { usdPerCharacter: 12 / 1_000_000 },
};
```

**The unit is wrong.** OpenAI bills `gpt-4o-mini-tts` at **$12/1M audio-OUTPUT tokens**, not
$12/1M input characters. `ttsCallCost` charges `chars × 12e-6`; the invoice charges
`audioOutputTokens × 12e-6` (+ a negligible text-in term).

The per-character *shape* is not arbitrary — it is **correct for `tts-1`/`tts-1-hd`**, which really
do bill per character. The bug is that the constant was carried to `gpt-4o-mini-tts`, which changed
the billing unit. The shape fits the legacy model and was never re-derived for the current one.

The two agree only if 1 character ≈ 1 audio-output token. **Measured, it is not** — durations from
§2.2 against the documented ≈20.83 audio-tokens/second (derived from $12/1M ↔ $0.015/min):

| Sample (92 chars) | Duration [MEASURED] | audio-out tokens [DERIVED] | **tokens per char** |
|---|---|---|---|
| marin-instructed | 5.448 s | ≈ 113 | **1.23×** |
| nova-plain | 6.120 s | ≈ 128 | **1.39×** |
| alloy-instructed | 7.056 s | ≈ 147 | **1.60×** |
| coral-instructed | 7.656 s | ≈ 159 | **1.73×** |
| alloy-plain | 7.752 s | ≈ 162 | **1.76×** |

⇒ **`rates.ts` under-prices TTS by 1.23×–1.76× depending on the voice** (~1.5× typical).

Per the file's own doctrine (`rates.ts:203-215`) — *"UNDER-estimating a rate makes the cap a LIE"* —
**this is the one direction that lets real spend exceed the user's monthly cap.** It is small today
(E-21 renders short cached corrections), **but this voice loop makes TTS the dominant cost of the
app**, at which point a 1.5× under-count stops being rounding.

Note the **voice choice changes the error by 43%** (marin 1.23× vs alloy 1.76×) — a per-character
model cannot express that at all, because speaking rate is a property of the voice, not the text.

> **Provenance:** the durations are [MEASURED]; the 20.83 tokens/second conversion is [DOCUMENTED]-
> derived, since `/v1/audio/speech` returns no `usage`. The exact multiplier is therefore
> **not fully verified**. The *direction* does not depend on it: it follows from the billing unit
> being audio-output tokens rather than characters, and every voice measured lands above 1.0×.

**Recommended fix (a work order, not this spike):** re-express as `usdPerAudioSecond`
(≈ `20.83 × 12e-6` ≈ **$0.00025/audio-second**) and cost from synthesized duration — which the loop
knows, because it holds the audio. If a *pre-call* bound on characters is structurally required,
keep the per-character shape but raise the constant to **at least `24 / 1_000_000`** (≥2× over the
worst measured 1.76×), with a comment naming audio-output tokens as the true unit. Round **up**,
never down.

`docs/research/spike-3-extraction-tutor.md` **already flagged this exact defect** on 2026-07-23
("fix `rates.ts`'s unit — it bills per-token, not per-character"). It was not acted on. **This is
the second independent finding of the same bug**; the measurements above are the evidence that was
missing the first time.

---

## 6 · The seam

Mirrors the two injection patterns already in the repo: `AudioModelClient`
(`lib/analysis/audio-model.ts:113`), an interface the orchestration depends on with a concrete
`export const openAiAudioModel: AudioModelClient` (`:456`) injected at the call site by
`scripts/worker.ts:66`; and `SpeakerEmbedder` (`lib/speaker/embedder.ts:23`), which adds an
`isAvailable()` capability probe and an async resolver.

Proposed `lib/voice/speech.ts` (interfaces only; impls in `lib/voice/openai-speech.ts`, later
`lib/voice/cartesia-speech.ts`):

```ts
/** One transcription of a learner's utterance. */
export interface Transcript {
  /** Recognized text, trimmed. Empty string when nothing intelligible was said —
   *  a silent turn is a normal outcome, never an error. */
  text: string;
  /** Provider+model for provenance and cost attribution, e.g. "openai:gpt-4o-transcribe". */
  source: string;
  /** Segment timings when the provider returns them. OPTIONAL by contract: whisper-1
   *  supplies them; gpt-4o-transcribe returns HTTP 400 for `verbose_json` (MEASURED),
   *  so no caller may require this. */
  segments?: { startMs: number; endMs: number; text: string }[];
}

export interface SpeechToText {
  readonly id: string;
  /** Whether this impl can run here (key present) — mirrors SpeakerEmbedder. */
  isAvailable(): boolean;
  transcribe(input: {
    /** Raw encoded bytes as captured (webm/opus from MediaRecorder, or wav). */
    audio: Uint8Array;
    /** Container mime, so the vendor can label its upload correctly. */
    mimeType: string;
    /** BCP-47 hint, e.g. "it". Advisory — a vendor may ignore it. */
    language?: string;
  }): Promise<Transcript>;
}

/** One synthesized reply. */
export interface Speech {
  audio: Uint8Array;
  /** Container actually returned, e.g. "audio/mpeg". */
  mimeType: string;
  source: string;
  /** Duration when known — the honest basis for TTS cost (§5.3), since
   *  /v1/audio/speech returns no `usage`. */
  durationMs?: number;
}

export interface TextToSpeech {
  readonly id: string;
  isAvailable(): boolean;
  /** Provider-scoped opaque voice id this impl speaks with by default. */
  readonly voice: string;
  synthesize(input: {
    text: string;
    /** Free-text style hint. OpenAI maps it to `instructions`; a vendor with only
     *  structured controls (Cartesia: speed/emotion) MAY ignore it. Optional by
     *  design — no caller may depend on it being honored. */
    style?: string;
    language?: string;
    voice?: string;
  }): Promise<Speech>;
  /** Streaming synthesis. Absent ⇒ caller falls back to `synthesize`. Optional so a
   *  non-streaming vendor stays conformant — but present because time-to-first-audio
   *  is what moves the turn from 4.63 s to ~2.9 s (§4). */
  synthesizeStream?(input: Parameters<TextToSpeech["synthesize"]>[0]): AsyncIterable<Uint8Array>;
}
```

**Why this survives a Cartesia swap.** Cartesia Sonic 3.5 supports Italian among 42 languages, 600+
voices, sub-90 ms time-to-first-audio, and exposes *structured* speed/volume/emotion controls rather
than a free-text instruction string [DOCUMENTED, cartesia.ai, 2026-07-25]. So the seam deliberately:

1. treats `voice` as an **opaque provider-scoped string**, never an enum of OpenAI voice names;
2. makes `style` an **optional hint a vendor may ignore** — the one OpenAI-specific concept, kept
   from leaking into the loop as a hard requirement;
3. makes `segments` **optional**, because timestamp support varies *within* OpenAI's own lineup
   (measured: a hard 400), let alone across vendors;
4. makes `synthesizeStream` **optional**, so a non-streaming vendor is still conformant;
5. returns **bytes + mimeType**, not a provider response object, so nothing vendor-shaped escapes.

Injection follows the house pattern exactly: the loop takes `SpeechToText` and `TextToSpeech` as
parameters, imports no concrete implementation, and the route/worker passes the real ones — so the
loop is unit-testable against plain mocks and no test makes a network call.

---

## 7 · Spend

| Item | Calls | Approx cost |
|---|---|---|
| `GET /v1/models` | ~25 (mostly 5xx, unbilled) | $0.000 |
| TTS syntheses (7 samples + 3 latency + 2 SSE + failures) | 12 billed | ~$0.002 |
| STT transcriptions (3 clean + 3 degraded + 2 verbose_json + 3 latency) | 10 billed | ~$0.001 |
| LLM completions (`gpt-4.1-mini`) | 5 billed, ~100 tok each | <$0.0001 |
| Web research | — | $0.000 |

**Total spent: ≈ $0.003 USD** (ceiling $1.00 — used ~0.3%). Failed 5xx requests are not billed.
The spend ceiling was never the binding constraint; the outage was.

## 8 · Recommendation

- **STT: `gpt-4o-transcribe`.** [MEASURED] 0.00% WER on clean *and* telephone-grade audio, and the
  **fastest** of the three (0.919 s / 0.944 s vs whisper-1's 1.610 s / 1.728 s). `whisper-1` is
  slower and offers only timestamps in exchange; `gpt-4o-mini-transcribe` is equally accurate here
  and half the price, so **switch to it if cost matters more than headroom** — STT is only ~15–27%
  of loop cost either way. Accept that timestamps are unavailable (hard 400).
  *Caveat: re-measure on real learner speech (§3) before treating this as final.*
- **TTS: `gpt-4o-mini-tts`** (pin `gpt-4o-mini-tts-2025-12-15`), `response_format: "mp3"`,
  **`stream_format: "sse"`**, with
  `instructions: "Parla come una madrelingua italiana colta: calma, precisa, calorosa, ritmo naturale."`
  — measurably steers pace (9% faster delivery on the same sentence vs no instructions).
- **Voice: the operator must choose by ear from §2.2.** The premise of this whole migration is that
  the current stack sounds wrong in Italian; picking a voice from a spec sheet would repeat exactly
  that mistake. Shortlist: **`coral`**, **`marin`** (fastest, 5.448 s — also the cheapest per §5.3),
  `alloy`, `nova`. Compare `alloy-plain` vs `alloy-instructed` first to hear what `instructions` does.
- **Expected per-turn latency: ~2.9 s with streaming TTS** (blocking would be 4.63 s) — inside the
  2–4 s band, not under 2 s. **Streaming is mandatory, not optional.** If sub-2 s is required,
  stream the LLM too and start TTS on the first complete sentence.
- **Expected cost: ≈ $0.10–0.11 per 10-minute conversation** — ~4.5× cheaper than
  `gpt-realtime-2.1-mini`, ~14× cheaper than flagship.
- **Fix `rates.ts` before shipping** (§5.3): TTS is under-priced 1.23–1.76×, the unsafe direction,
  and the voice loop makes TTS the app's dominant cost path.

## Sources

All retrieved **2026-07-25**.

- [gpt-4o-mini-tts model page](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) — $0.60/1M text-in, $12/1M audio-out.
- [gpt-4o-transcribe model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe) — $2.50/1M audio-in, $10/1M text-out.
- [tts-1 model page](https://developers.openai.com/api/docs/models/tts-1) — $15/1M characters; tts-1-hd $30/1M.
- [Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) — 13 voices, `instructions`, response formats.
- [Speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text) — response formats, timestamp granularities.
- [OpenAI status page](https://status.openai.com/) — "Elevated error rates" incident.
- [Cartesia Italian TTS](https://www.cartesia.ai/languages/italian), [Sonic docs](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest) — 42 languages, 600+ voices, sub-90 ms TTFA.
- Secondary/unverified: [costgoat.com](https://costgoat.com/pricing/openai-transcription) — per-minute STT rates.
- In-repo: `lib/analysis/rates.ts`, `lib/analysis/audio-model.ts`, `lib/speaker/embedder.ts`, `scripts/worker.ts`, `docs/research/spike-3-extraction-tutor.md`.

## Appendix — reproducing this

Harness in `…/scratchpad/spike-voice/`: `runall.sh` (whole spike), `tts.sh`, `stt.sh`,
`wer.py` (exact WER), raw `results.txt`. Scratchpad is session-scoped and may be garbage-collected;
the scripts are short enough to recreate from this document. **The `.mp3` samples in §2.2 are the
perishable artifact — copy them somewhere durable before the scratchpad is cleaned.**
