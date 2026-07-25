# Spike 6 — How the tutor listens: Realtime (text out) vs the `gpt-audio` family

*Research spike, 2026-07-25. READ-ONLY spike; no product code written, no existing source file
modified. Decides D-28's open question by measurement.*

**Provenance discipline.** Every number is **[MEASURED]** (a live call this session — command,
HTTP status and observed value given), **[DOCUMENTED]** (a published figure — URL and retrieval
date), or **[DERIVED]** (computed from the two, both inputs named). This repo has been burned three
times by code drifting from its own research, so an unverified claim is marked unverified rather
than rounded into confidence.

> **Outage note.** The brief warned of an OpenAI incident that cleared at 09:44 UTC. This spike ran
> **10:35–11:29 UTC** and hit **no 5xx and no rate limit**: every one of ~130 calls returned HTTP
> 200 first time. The retry-with-backoff wrappers in the harness never fired. Nothing here is
> degraded by the incident.

---

## 0 · The gating question, answered first

**Can a Realtime session be configured for audio input with text-only output? YES — measured two
independent ways, on the live GA API, with this repo's own key.**

**(i) Over the session WebSocket** [MEASURED, 10:38 UTC]:

```
wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1   → HTTP 101 (WS OPEN)
→ session.created   output_modalities = ["audio"]        (the default)
→ session.update    { "type":"realtime", "output_modalities":["text"],
                      "audio": { "input": { "format": {"type":"audio/pcm","rate":24000},
                                            "turn_detection": {"type":"server_vad", …} } },
                      "tools":[ log_evidence ], "tool_choice":"auto" }
→ session.updated   output_modalities = ["text"]          ← ACCEPTED AND ECHOED
```

**(ii) Through the product's own mint path** — `POST https://api.openai.com/v1/realtime/client_secrets`
with `session.output_modalities = ["text"]` → **HTTP 200** [MEASURED], and the returned
`session` object echoes `"output_modalities": ["text"]`.

**What the API actually accepts, stated plainly:**

- The field is **`output_modalities`** on the GA session object (the beta name `modalities` is
  what community threads describe; this account's GA sessions use `output_modalities`) [MEASURED].
- **`["text"]` is a legal value.** The default when unset is `["audio"]` [MEASURED — that is what
  `session.created` returned before any update].
- The `audio.output` sub-object (`voice`, `format`, `speed`) **remains present and is simply not
  used**; it does not have to be removed and does not 400. `session.updated` still reported
  `audio.output.voice = "marin"` alongside `output_modalities: ["text"]` [MEASURED].
- **Function tools work unchanged** with text-only output (§4).
- **Server VAD works unchanged** with text-only output. Defaults observed live:
  `threshold 0.5, prefix_padding_ms 300, silence_duration_ms 500, idle_timeout_ms null,
  create_response true, interrupt_response true` [MEASURED].

**One honest gap.** Both proofs above are HTTPS/WebSocket. The product connects over **WebRTC**
(`lib/tutor/realtime-client.ts`), which needs a real browser; **this spike did not verify the
WebRTC leg end-to-end.** The session object is transport-independent and the mint that feeds WebRTC
accepted the field (HTTP 200), so the risk is low — but it is not zero and it is not measured.

> **A consequence worth naming.** If output is text, the one thing WebRTC was buying — a
> jitter-buffered *downstream audio track* — is no longer used. Audio only needs to go **up**.
> A browser WebSocket carrying PCM up and text down would do the same job without SDP
> offer/answer negotiation. See §6.

---

## 1 · Headline findings

1. **Both transports carry the signal. Both catch roughly the same errors.** Best-of-family:
   `gpt-realtime-2.1` **5/7 caught, 0 hallucinations**; `gpt-audio-1.5` **5/7 caught,
   0 hallucinations** on the same audio [MEASURED]. This is a near-tie on accuracy.
2. **But the two families fail on *different* items, and one failure is damning.** Every
   `gpt-audio` model missed **`"ho andato"`** — the single most canonical Italian learner error,
   named verbatim in this repo's own `lib/mistakes.ts` — on **9 of 9 attempts**. Both Realtime
   models caught it every time [MEASURED].
3. **Both land in the 2–4 s band, neither under 2 s.** (A) ≈ **2.43 s**, (B) ≈ **2.80 s** to first
   audio of the reply, reusing spike-5's measured 0.844 s TTS TTFB [DERIVED from MEASURED].
4. **Cost is a near-tie too:** (A) `gpt-realtime-2.1` ≈ **$0.28**, (B) `gpt-audio-1.5` ≈ **$0.34**
   per 10-minute conversation [DERIVED]. Both are ~3× spike-5's D-3-violating STT loop ($0.10).
   That 3× is the price of D-28, and it is affordable.
5. **🚩 `rates.ts` under-prices the whole `gpt-audio` family on short turns — the unsafe
   direction.** `gpt-audio-1.5` is ledgered at $0.03/audio-minute; a measured 5.15 s tutor turn
   costs **$0.0574/audio-minute** — 1.9× over. `gpt-audio-mini` is ledgered at $0.006 and measures
   **$0.0152** — 2.5× over, and **over even at 10-minute analysis scale** ($0.0067). Details and
   the exact cause in §5.4.
6. **`gpt-realtime-2.1-mini` is not a usable listening leg.** 3 of 9 replies were empty
   (reasoning tokens spent, zero visible text), 2 were hallucinated errors on correct speech, and
   several ignored the JSON contract entirely [MEASURED, §3.2]. If (A) wins, it wins at flagship
   price.
7. **A bonus confirmation of D-3, measured live.** `whisper-1` transcribed the sentence containing
   the deliberately mis-rendered `"familia"` as **`"famiglia"`** — it silently repaired the very
   error under test. Same for `"note"` → `"notte"` (§2.2). *The transcript erased the signal*, in
   the exact words of D-3, on this spike's own fixtures.

---

## 2 · The test set

### 2.1 What it is — and what it is NOT

Nine labelled Italian clips, synthesized with `gpt-4o-mini-tts-2025-12-15`, voice `alloy`, plain
(D-28's settled speaking half), `response_format: "wav"` → 24 kHz mono PCM [MEASURED, all HTTP 200].
Four grammar/word-choice errors, three pronunciation errors, **two clean controls**.

The clean controls exist because **hallucinated errors matter as much as missed ones** — this
repo's persona forbids inventing errors (`PRECISION_CORE_LINES`, `lib/mistakes.ts`), and a
transport that over-flags is worse than one that under-flags. C1 and C2 are deliberately the
*corrected* forms of G1 and G2/G3, so a model that pattern-matches on the topic rather than
listening will trip on them.

> ### ⚠️ Label this honestly (D-13)
>
> **These are synthetic fixtures. They prove mechanism, never judgment.** TTS speech is
> unnaturally clean: no accent, no hesitation, no false start, no background noise, no L1
> interference — none of the things an advanced learner's Italian actually contains. What is being
> tested here is **whether a transport can carry the signal to a model that can act on it**. What
> is **not** produced here is a validated accuracy score for either transport, and the per-item
> table below must never be quoted as one. n=9, one voice, one take. A real accuracy claim needs
> real learner audio, which this spike does not have and does not pretend to have.
>
> The pronunciation items are a **proxy**: TTS is made to speak a deliberate misspelling so it
> renders the wrong sounds. That tests the transport's ability to carry a phonetic deviation; it
> does **not** reproduce how a human learner's `/ʎ/` actually fails.

### 2.2 Fixture validation [MEASURED] — including the D-3 demonstration

Each clip was transcribed by `whisper-1` (`response_format=text`, `language=it`) purely to check
**what sounds the TTS actually produced**. This is fixture validation, not error detection — no
D-3 conflict.

| id | class | spoken text | planted error | whisper-1 heard | fixture valid? |
|---|---|---|---|---|---|
| **G1** | grammar | "Ieri **ho andato** al cinema con i miei amici e mi è piaciuto molto." | `ho andato` → `sono andato` (auxiliary) | *ho andato* | ✅ |
| **G2** | grammar | "Secondo me **la problema** è molto grave e nessuno vuole affrontarla." | `la problema` → `il problema` (noun gender) | *la problema* | ✅ |
| **G3** | word choice | "Domani mattina **faccio una decisione** importante sul mio lavoro." | calque → `prendo una decisione` | *faccio una decisione* | ✅ |
| **G4** | word choice | "**Attualmente** hai ragione tu, mi ero sbagliato completamente." | false friend → `in realtà` | *attualmente* | ✅ |
| **P1** | pronunciation | "Mi piace molto il pane con l'**algio** e l'olio." | `/ʎ/` → `/ldʒ/` | *l'algio* | ✅ |
| **P2** | pronunciation | "Ho preparato i **nocchi** di patate per cena." | `/ɲ/` → `/n/` | *i nocchi* | ✅ |
| **P3** | pronunciation | "Tutta la mia **familia** viene dalla Sicilia." | `/ʎ/` → `/li/` | **"famiglia"** ⚠️ | ✅ (see below) |
| **C1** | clean | "Ieri sera sono andato al cinema con i miei amici e il film mi è piaciuto molto." | *none* | exact | ✅ |
| **C2** | clean | "Il problema è che non ho ancora preso una decisione sul lavoro." | *none* | exact | ✅ |

**P3 needed a second check, and it produced the best finding in this spike.** whisper-1 rendered
the sentence as *"famiglia"* — the correct word. Two possibilities: the TTS never spoke the wrong
sound, or **the transcript silently repaired it**. Resolved by synthesizing the words in isolation
[MEASURED, all HTTP 200]:

| synthesized input | duration | whisper-1 heard |
|---|---|---|
| `"familia"` | 1.20 s | **"FAMINIA"** |
| `"famiglia"` | 1.40 s | "famiglia" |
| `"algio"` | 0.90 s | **"Aldio."** |
| `"aglio"` | 1.10 s | "Alio" |

The TTS **did** render `familia` as a different phoneme sequence. Corroborated at sentence level:
`P3.wav` (familia) is **3.45 s** against **2.70 s** for the identically-worded control spelled
`famiglia` — a 28% difference in the same voice [MEASURED]. So P3 is a valid fixture, **and
whisper-1 normalised the error out of existence inside a sentence.** A tenth probe behaved the
same way: `"che note terribile"` (gemination dropped) came back as **`"che notte terribile"`**.

> **This is D-3's claim, measured on this spike's own bench.** *"A transcript erases exactly the
> signal an advanced learner needs."* Two of three pronunciation fixtures were silently corrected
> by the STT layer. Had the tutor been rebuilt on STT → LLM → TTS as D-26 first ruled, it would
> have been handed clean sentences and reported no errors. **D-28's correction of D-26 is
> vindicated by measurement, not just by argument.**

### 2.3 The prompt — identical for both transports

Both transports received **byte-identical listening instructions**, composed programmatically from
this repo's own shared definition of a mistake — `MISTAKE_CLASS_LINES` + `PRECISION_CORE_LINES`
from `lib/mistakes.ts` (the same source `lib/analysis/prompts.ts` and `lib/tutor/persona.ts`
compose), plus a JSON output contract. **1 365 tokens** [MEASURED via the API's own `usage`:
1 663 text-input tokens on the Realtime path, 1 299 on the chat path]. Neither transport was
judged against a prompt the product would not use, and neither got an advantage.

---

## 3 · Does it catch the mistakes?

### 3.1 The per-item table [MEASURED]

`✓` caught · `✗` missed · `!` **hallucinated** (an error reported where none exists, or a
correction that is itself wrong) · `∅` empty/absent reply · `~` right locus, wrong diagnosis.
`clean` = correctly returned `{"errors": []}` on a control.

| | **(A) `gpt-realtime-2.1`** | **(A) `gpt-realtime-2.1-mini`** | **(B) `gpt-audio-1.5`** (wav) | **(B) `gpt-audio-1.5`** (mp3) | **(B) `gpt-audio-mini`** | **(B) `gpt-audio`** |
|---|---|---|---|---|---|---|
| **G1** `ho andato` | ✓ grammar | ✓ grammar | ✗ | ✗ | ✗ | ✗ |
| **G2** `la problema` | ✓ grammar | ✓ *(prose, self-contradictory)* | ✓ | ✓ | ✓ | ✓ (+1 extra, defensible) |
| **G3** `faccio una decisione` | ✓ idiom | ∅ | ✓ | ✓ | ✓ | ✓ |
| **G4** `attualmente` | ✓ vocabulary | ✓ **+ 1 !** | ✓ | ✓ | ✗ | ∅ *"please provide the audio clip"* |
| **P1** `algio` | ✓ *(as vocabulary)* | ∅ | ✓ **as pronunciation** | ✓ **as pronunciation** | ✓ *(as vocabulary)* | ~ *(called it an apostrophe error)* |
| **P2** `nocchi` | ✗ | ✓ *(prose)* | ✓ ×2 *(dup)* | **!** *(quote == correction; invented a `gli` error, missed `nocchi`)* | ✓ **+ 1 !** | ✓ pronunciation |
| **P3** `familia` | ✗ | ✗ | ✗ | ✗ | ✗ | ∅ *"please provide the audio clip"* |
| **C1** *clean* | clean ✅ | **!** *("con i mi amici" — invented)* | clean ✅ | clean ✅ | clean ✅ | clean ✅ |
| **C2** *clean* | clean ✅ | ∅ | clean ✅ | clean ✅ | **!** *("preso" → "presa" — wrong)* | **!** *(nonsense correction)* |
| **CAUGHT / 7** | **5** | 4 | **5** | 4 | 4 | 3 (+1 partial) |
| **HALLUCINATIONS** | **0** | **2** | **0** | 1 | 2 | 2 |
| **EMPTY REPLIES** | 0 | 3 | 0 | 0 | 0 | 2 |

### 3.2 What the table means

**`"ho andato"` is the finding that separates the families.** Both Realtime models caught it every
time. **Every** `gpt-audio` model missed it, and repeat runs confirm it is not sampling noise:
`gpt-audio-1.5` returned `{"errors": []}` on G1 in **6 of 6** independent calls (3 wav + 3 mp3),
`gpt-audio-mini` in **3 of 3**, `gpt-audio` in **1 of 1** [MEASURED]. This is the auxiliary-choice
error written verbatim into `lib/mistakes.ts` line 42 — *"(\"ho andato\" — \"sono andato\")"* — so
the model was told the answer in its own prompt and still did not hear it. Whatever the cause, it
is a reproducible blind spot in the family this repo already trusts on the analysis path, and it is
worth a follow-up on the Record path independently of this decision.

**Pronunciation is where (B) is stronger.** `gpt-audio-1.5` caught **P1 and P2 and labelled both
`pronunciation`**, with a correct phonetic explanation (`/ˈɲɔkki/` vs `/ˈɔkki/`). `gpt-realtime-2.1`
caught P1 but filed it as `vocabulary`, and missed P2 entirely. Both missed P3 — the hardest proxy.
So the families are **complementary, not ranked**: Realtime is better at grammar, `gpt-audio` at
phones. Consistent with D-21, which already says phone-level judgments from audio LLMs are
unreliable and belongs to Azure PA anyway.

**Hallucination is where (A)-flagship and `gpt-audio-1.5` are jointly clean and everything else is
not.** The two clean controls did their job: they caught `gpt-audio-mini` inventing a
participle-agreement rule that does not exist (*"preso" → "presa"* — with `avere` the participle
does not agree with a following direct object), `gpt-audio` producing a correction identical in
meaning to the original, and `gpt-realtime-2.1-mini` mishearing *"con i miei amici"* as
*"con i mi amici"* and correcting the misheard version. Per `PRECISION_CORE_LINES`, *"a false
correction is worse than a missed one."* Three of six configurations fail that bar.

**`gpt-audio` (the D-3 fallback) has a distinct failure mode worth recording:** twice it replied
*"Please provide the audio clip…"* despite a valid `input_audio` part in the same message that
seven other calls processed fine. A tutor that periodically claims it heard nothing is a product
defect, and `gpt-audio` is the model `DEEP_MODELS` falls back to.

**Off-vocabulary categories, a live parser bug.** `gpt-audio-1.5` returned
`"category": "vocabulary and word choice"` on 3 of 27 findings [MEASURED]. That string is not in
`CATEGORY_ALIASES` (`lib/analysis/findings.ts:161`), so `normalizeCategory` returns `null` and
`parseDeepResponse` **rejects the entire response** — every finding in that segment lost. The label
the model reached for is the header phrase from `MISTAKE_CLASS_LINES` itself
(*"VOCABULARY AND WORD CHOICE"*), so the shared prompt is teaching a category name the shared
parser refuses. One alias entry fixes it; it affects the **Record path today**, not just the tutor.

---

## 4 · `log_evidence` — both transports carry tool calls [MEASURED]

Confirmed live, with the real `log_evidence` schema from `lib/tutor/session-config.ts`.

**(A) Realtime, `output_modalities: ["text"]`** — tool calls arrive on the event channel exactly as
`lib/tutor/realtime-client.ts` already expects:

```
response.function_call_arguments.done
  name = "log_evidence"
  arguments = "{\"itemId\":\"rule:test-item\",\"polarity\":\"incorrect\",\"mode\":\"spontaneous\"}"
```

Over a 6-turn warm session, **7 well-formed `log_evidence` calls** across 4 turns [MEASURED].
`extractLogEvidenceCall` handles this shape unchanged. **Text-only output does not disable tools.**

**(B) `gpt-audio-1.5` over chat/completions** — standard tool calling, `finish_reason: "tool_calls"`,
arguments assembled from `delta.tool_calls[].function.arguments` [MEASURED, 2 of 3 probe turns].
Note it emits **both** a tool call and text content in the same response, so the loop must read both.

**Verdict: `log_evidence` survives either choice.** Not a discriminator.

---

## 5 · Latency and cost

### 5.1 How latency was measured, and why it is fair

**"Learner stopped speaking" is defined identically for both.**

For **(A)**, the clip is streamed to the open session in **100 ms frames paced at 1× realtime**, so
server VAD experiences a real conversation rather than a bulk upload. The instant the learner
stopped making sound is taken from the server's own `input_audio_buffer.speech_stopped` event
(`t_stream_start + audio_end_ms`) — so the **500 ms `silence_duration_ms` VAD hangover is fully
counted inside (A)'s number**, and trailing silence in the clip cannot flatter it.

For **(B)**, the timer starts when the request is sent. A real (B) client must first detect
end-of-turn locally, so **the same 500 ms silence hangover is added to (B)** by hand. Neither
transport is credited with turn detection it did not pay for.

Both then add **0.844 s TTS time-to-first-audio**, spike-5's measured SSE `time_starttransfer` on
`gpt-4o-mini-tts` — reused, not re-measured, per the brief.

### 5.2 Per-turn latency, 5-second learner turn [MEASURED, n=9 each]

| Transport / model | to first text | **to full text** | + VAD | + TTS TTFB | **= first audio of reply** | band |
|---|---|---|---|---|---|---|
| **(A) `gpt-realtime-2.1`** | p50 **1.194 s** (0.965–2.894) | p50 **1.588 s** (1.104–3.566) | *(included)* | +0.844 | **≈ 2.43 s** | **2–4 s** |
| **(A) `gpt-realtime-2.1-mini`** | p50 1.608 s (0.962–2.745) | p50 1.696 s (0.753–3.073) | *(included)* | +0.844 | ≈ 2.54 s | 2–4 s |
| **(B) `gpt-audio-1.5`** (mp3) | p50 1.050 s (0.878–1.612) | p50 **1.458 s** (0.931–2.178) | +0.500 | +0.844 | **≈ 2.80 s** | **2–4 s** |
| **(B) `gpt-audio-mini`** (wav) | p50 1.221 s (0.935–3.401) | p50 1.454 s (1.093–3.727) | +0.500 | +0.844 | ≈ 2.80 s | 2–4 s |
| **(B) `gpt-audio`** (wav) | p50 1.240 s (0.882–1.296) | p50 1.597 s (1.107–2.699) | +0.500 | +0.844 | ≈ 2.94 s | 2–4 s |

**Stated plainly: both transports land in the 2–4 s band. Neither reaches under 2 s.** (A) is
~0.37 s faster, entirely because its VAD hangover overlaps work it has already done — the audio is
*already at the model* when the learner stops.

Two caveats that push both numbers around:

- The reply measured here is a JSON error list (42–388 output tokens); a real conversational tutor
  reply is shorter, which helps **both** equally. Starting TTS on the first complete sentence would
  cut both further, as spike-5 §4 already recommends.
- `gpt-realtime-2.1` spends **reasoning tokens** — 33–220 per reply, often >70% of output
  [MEASURED from `output_token_details.reasoning_tokens`]. That is latency (A) pays and (B) does
  not: `gpt-audio-1.5` reported `reasoning_tokens: 0` on every call.

### 5.3 🚩 Payload size, and a trap (B) must not fall into [MEASURED]

(B) uploads the turn *after* it ends, so payload size is on the critical path. This is not a
rounding effect:

| turn | container | base64 payload | ttft p50 | full p50 |
|---|---|---|---|---|
| 5.15 s | wav (PCM) | 330 KB | 1.598 s | 1.658 s |
| 5.15 s | **mp3 64 kbps** | **56 KB** | **0.998 s** | **1.033 s** |
| 33.8 s | wav (PCM) | 2.2 MB | **20.3 s** (9.3–34.5 s) | **22.8 s** (10.3–35.6 s) |
| 33.8 s | **mp3 64 kbps** | **361 KB** | **1.949 s** | **4.087 s** |

**A 33.8-second turn sent as PCM took between 9 and 35 seconds** — unusable, and wildly variable.
The same turn as 64 kbps mp3 took 1.9 s. **(B) must compress before upload, without exception.**
(`MediaRecorder` gives webm/opus for free, and the Record path already uses mp3 per D-3, so this is
a discipline to write down, not a new problem.) The wav-based (B) numbers in §5.2 are therefore
*pessimistic* by ~0.6 s; the mp3 row is the honest one.

**(A) does not have this failure mode** — audio streams during speech, so nothing is left to upload
when the turn ends. But **(A) is not flat on long turns either**, for a different reason: on the
same 33.8 s clip it took **6.871 s** to full text (6.170–9.336 s) because the reply itself was
660 tokens including 312 of reasoning [MEASURED]. On long turns, **(B)-with-mp3 is actually the
faster of the two** (4.087 s vs 6.871 s). Neither transport wins the long-turn case cleanly, and
neither is inside the band there.

### 5.4 Cost per 10-minute conversation

**Unit rates** [DOCUMENTED, `developers.openai.com/api/docs/pricing` and model pages, retrieved
2026-07-25], per 1M tokens:

| model | text in | cached text | text out | audio in | cached audio |
|---|---|---|---|---|---|
| `gpt-realtime-2.1` | $4.00 | $0.40 | **$24.00** | $32.00 | $0.40 |
| `gpt-realtime-2.1-mini` | $0.60 | $0.06 | $2.40 | $10.00 | $0.30 |
| `gpt-audio` / `gpt-audio-1.5` | $2.50 | — | $10.00 | $32.00 | — |
| `gpt-audio-mini` | $0.60 | — | $2.40 | *not published* ⚠️ | — |

⚠️ **`gpt-audio-mini`'s audio-input rate is not published on its model page** (retrieved
2026-07-25); $10/1M is assumed here as an upper bound consistent with the mini realtime tier. Every
`gpt-audio-mini` figure below inherits that uncertainty. Note the flagship realtime **text output
rate is $24/1M**, not the $16 the older `gpt-realtime` model page shows — `rates.ts` models neither.

**Measured audio-token throughput** [MEASURED, from real `usage` across 10 clips, 3.45–33.80 s]:
**10.47 audio-input tokens/second = 628 per audio-minute** (spread 505–665/min). This is the first
figure in this repo measured against real `usage` rather than inferred — `rates.ts`'s standing
"OWED" reconciliation, partially discharged. It confirms `realtimeAudioTokensPerMinute`'s default
of **1500/min over-books input by 2.4×** — the safe direction, exactly as that function's comment
intends.

**A 10-minute conversation** [DERIVED: 20 turns, 5 min learner audio = 3 140 audio-in tokens at the
measured 628/min, ~120 output tokens/turn including reasoning, 5 min tutor speech through TTS at
the documented $0.015/audio-min; (A) modelled with the **measured** prompt-cache behaviour of §5.5]:

| path | listening leg | TTS | **total** | vs spike-5 STT loop |
|---|---|---|---|---|
| **(A) `gpt-realtime-2.1`** | $0.2075 | $0.075 | **$0.283** | 2.7× |
| **(A) `gpt-realtime-2.1-mini`** | $0.0446 | $0.075 | $0.120 | 1.1× |
| **(B) `gpt-audio-1.5` / `gpt-audio`** | $0.2654 | $0.075 | **$0.340** | 3.2× |
| **(B) `gpt-audio-mini`** | $0.0710 | $0.075 | $0.146 | 1.4× |
| *spike-5 pure STT loop (D-3-violating)* | — | — | *$0.098–0.113* | 1× |
| *`rates.ts` `realtimeSessionCost(flagship, 10)`* | — | — | *$1.440* | — |
| *`rates.ts` `realtimeSessionCost(mini, 10)`* | — | — | *$0.450* | — |

**Cost does not decide this.** (A)-flagship is **17% cheaper** than (B) on the models that actually
perform (`gpt-realtime-2.1` $0.283 vs `gpt-audio-1.5` $0.340) — a reversal of the assumption in
D-26 that realtime is the expensive option. The reversal has one cause: **taking the reply as text
removes the $64/1M audio-output leg**, which was the bulk of realtime's cost. D-28's own design
choice is what makes (A) affordable.

Both are ~3× the D-3-violating STT loop. That premium is the measured price of D-28, and against a
default cap it is small.

### 5.5 Why (A) is cheaper than it looks: prompt caching [MEASURED]

A warm 6-turn session, one connection:

| turn | input tokens | of which text | audio | **CACHED** | fresh |
|---|---|---|---|---|---|
| 1 | 1 716 | 1 663 | 53 | 0 | 1 716 |
| 2 | 1 865 | 1 754 | 111 | **1 664** | 201 |
| 3 | 1 998 | 1 836 | 162 | **1 856** | 142 |
| 4 | 2 120 | 1 911 | 209 | **2 048** | 72 |
| 5 | 2 257 | 1 979 | 278 | **2 112** | 145 |
| 6 | 2 318 | 1 997 | 321 | **2 240** | 78 |

Realtime re-sends the whole conversation on every turn — nominally quadratic — but **96%+ of it
hits the cache** at $0.40/1M instead of $4.00 (text) or $32.00 (audio), an 80× discount on the
audio. The quadratic is neutralised in practice.

**(B) got no such relief:** `prompt_tokens_details.cached_tokens` was **0 on every one of ~50 chat
calls** [MEASURED], despite an identical 1 299-token prefix on every request. So (B) pays full price
for the persona on every turn, forever, and (B)'s cost grows with conversation history carried as
text while (A)'s does not.

### 5.6 🚩 Rates in `lib/analysis/rates.ts` that sit BELOW measured reality

Per that file's own doctrine (`rates.ts:203-215`) — *"UNDER-estimating a rate makes the cap a
LIE"* — these are the unsafe direction and must be fixed before a `gpt-audio`-based tutor ships.

**The cause is structural, not a wrong constant.** `callCost(model, durationMs)` bills purely
per **audio-minute** and therefore charges **nothing for the text prompt**. On the analysis path
that is harmless: one prompt amortised over a 10-minute segment is noise. **On a tutor path the
same prompt is re-sent every 5 seconds**, so the fixed text cost dominates and the per-minute
model collapses.

Measured on one real 5.15 s tutor turn (`usage`: 1 299 text-in, 51 audio-in, 5 text-out):

| model | `rates.ts` ledgers | **measured, 5 s tutor turn** | **measured, 10 min analysis segment** | verdict |
|---|---|---|---|---|
| `gpt-audio-1.5` | $0.030 /audio-min | **$0.0574** — 🚩 **1.9× UNDER** | $0.0219 — safe ✅ | fix **for the tutor**; analysis is fine |
| `gpt-audio` | $0.050 /audio-min | **$0.0574** — 🚩 **1.15× UNDER** | $0.0219 — safe ✅ | fix **for the tutor** |
| `gpt-audio-mini` | $0.006 /audio-min | **$0.0152** — 🚩 **2.5× UNDER** | **$0.0067** — 🚩 **1.1× UNDER** | 🚩 **under-priced even on the analysis path today** |

The `gpt-audio-mini` analysis-path flag is the one to act on regardless of this spike's outcome:
`MINI_MODEL` triages **every** segment of **every** capture, so a systematic under-count there
compounds across the whole product. It survives the unpublished-audio-rate caveat: even assuming
audio input were **free**, the text prompt alone puts a 5 s turn at **$0.0093/audio-minute**, still
above the ledgered $0.006.

**Two more rate gaps, both in the safe direction but both modelling the wrong thing:**

- **`rates.ts` has no text-token rate for the realtime models at all.** Under (A) the reply is
  text, so the dominant output cost is `$24/1M` text-out — a line item `REALTIME_RATES` does not
  have. `realtimePerMinuteUsd` instead charges 1500 audio-output tokens/min at $64/1M for audio
  **that will never be generated**. Result: $1.44 modelled against $0.28 measured — a **5.1×
  over-book**. Safe, but it makes the cap fire ~5× early and makes every tutor estimate fiction.
- **`TTS_RATES` is still per-character** (`rates.ts:139`). Not re-measured here; spike-3
  (2026-07-23) and spike-5 (2026-07-25) both already flagged the unit as wrong. **This is now the
  third independent finding of the same defect,** and D-28 already names repricing it as
  not-optional. Under either transport TTS becomes a dominant cost path.

---

## 6 · Complexity — what each transport costs to hold in your head

Line counts [MEASURED, `wc -l`]:

| file | lines | under (A) | under (B) |
|---|---|---|---|
| `lib/tutor/mint.ts` | 112 | survives | **deleted** |
| `lib/tutor/realtime-client.ts` | 177 | survives | **deleted** |
| `app/api/tutor/session/route.ts` | 92 | survives | reshaped (~40 lines simpler) |
| `lib/tutor/session-config.ts` | 186 | survives + `output_modalities` | ~½ reshaped |
| `tests/tutor-mint-body.test.ts` | 116 | survives | **deleted** |
| `tests/tutor-realtime-client.test.ts` | 108 | survives | **deleted** |
| `lib/tutor/money.ts` · `persona.ts` · `log-evidence.ts` | 483 | survives | survives |
| `app/practice/tutor/page.tsx` · heartbeat · evidence · end · dots-field | 506 | survives | survives |

**(B) deletes ≈ 290 lines of product code and ≈ 224 lines of test — ~510 lines total.** Roughly
**a third** of the tutor's transport-specific surface. That is real.

**But it is a trade of concepts, not a pure subtraction.**

**(B) removes 7 concepts:** the ephemeral client secret and its ~60 s TTL; the SDP offer/answer
exchange; `RTCPeerConnection` and track wiring; the `oai-events` data channel; the mint wire-field
allowlist (`MINT_SESSION_WIRE_FIELDS` — the OBS-001 400 trap, a scar the codebase still carries);
server-VAD configuration; the Realtime event taxonomy.

**(B) adds 4:** browser-side turn detection (§7); client-side audio encoding and upload with a
hard compression requirement (§5.3); conversation memory the loop must assemble and carry itself
(the Realtime session held it for free); and server-side SSE relay so the reply still streams.
**One of the four — turn detection — is harder than any single thing it removes.**

> **A subtraction available to (A) too, and D-26 would want it named.** If output is text, WebRTC's
> only remaining job is carrying audio **up**. A browser WebSocket sending PCM/Opus up and
> receiving text down needs no SDP negotiation, no `RTCPeerConnection`, no track plumbing — and
> `getUserMedia` still supplies echo cancellation independently of WebRTC. That would delete
> `realtime-client.ts`'s handshake half (~90 lines) and 3 of the 7 concepts **while keeping (A)'s
> listening quality and server-side VAD**. It still needs the ephemeral secret (a browser must not
> hold the key). **This is the shape worth building if (A) wins,** and it is not measured here.

---

## 7 · Turn-taking

**(A) gets it from the server, tuned, for free.** Live defaults [MEASURED from `session.created`]:
`server_vad`, `threshold 0.5`, `prefix_padding_ms 300`, `silence_duration_ms 500`,
`create_response true`, `interrupt_response true`. The last flag is barge-in — the learner talking
over the tutor cancels the reply — and it costs zero lines. `semantic_vad` is also available
[DOCUMENTED, realtime-conversations guide, retrieved 2026-07-25]: it ends a turn on **meaning**
rather than energy, which is the one thing an energy threshold can never do.

**(B) must build all of it in the browser.** Concretely it needs:

1. **A neural VAD, not an energy threshold.** An `AnalyserNode` RMS gate (~30 lines) is the obvious
   cheap answer and is not good enough: it fires on a door slam and stays silent through quiet
   speech. The realistic bar is a Silero-class WASM VAD (`@ricky0123/vad-web`, ~1.5 MB model) —
   a new client dependency, weighed against DESIGN.md's "no component frameworks" temperament
   (it is not a UI framework, but it is weight).
2. **A ~300 ms pre-roll ring buffer**, matching `prefix_padding_ms`, so the turn's first phoneme is
   not clipped. **This is not cosmetic here:** P1/P2/P3 each turn on the sounds of a *single word*.
   Clip 200 ms and the fixture under test is gone.
3. **A hangover tuned against hesitation, which is the hard part.** An advanced learner pausing
   mid-sentence to search for a word is producing *exactly* the signal D-3 exists to preserve. A
   naive 500 ms hangover cuts them off and splits one thought into two turns; a generous 1 200 ms
   one makes every exchange feel dead. (A) has the same tension but it is OpenAI's to tune, and
   `semantic_vad` is a one-line escape hatch (B) cannot replicate.
4. **Barge-in**, i.e. cancelling in-flight TTS playback and the pending request when speech resumes
   — free under (A) via `interrupt_response`.
5. **Compression before upload** (§5.3) — non-negotiable, 9–35 s penalty if skipped.

**How good does browser VAD have to be? At least as good as `server_vad`'s defaults**, because the
failure modes are not graceful. A turn cut short yields a fragment, and fragments are precisely
what made models in §3 hallucinate — `gpt-audio` twice claimed it received no audio, and
`gpt-realtime-2.1-mini` invented *"con i mi amici"* from a clean sentence. **Bad turn detection
does not degrade the tutor gently; it manufactures false corrections**, the one failure
`PRECISION_CORE_LINES` forbids outright.

**A structural asymmetry worth naming.** Under (A), turn N's judgment can draw on the **audio** of
turns 1…N-1 — measured: audio tokens accumulate in session context (53 → 111 → 162 → 209 → 278 →
321), cheaply, because they cache. Under (B), each call hears **one turn in isolation**; history
can only be carried as *text*. That is not a D-3 violation — error detection still happens on audio,
per turn — but the tutor's *memory* becomes a transcript, lossy in exactly the dimension D-3 names.
For a tutor whose job includes *"you have done this three times today"*, **(A) hears the
conversation; (B) hears an utterance.**

---

## 8 · Spend

Ceiling **$1.50**. Derived from real `usage` returned by the API plus the documented rates in
§5.4 — this is a modelled total, not an invoice.

| item | calls | approx USD |
|---|---|---|
| `GET /v1/models`, realtime session probe, `client_secrets` mint | 4 | ~0.001 |
| TTS fixture synthesis (9 fixtures + 2 controls + 4 isolated words) | 15 | ~0.015 |
| `whisper-1` fixture validation | 15 | ~0.005 |
| `gpt-realtime-2.1` — 9-fixture set + smoke | 10 | 0.120 |
| `gpt-realtime-2.1` — 3 warm multi-turn sessions (18 turns) | 18 | 0.168 |
| `gpt-realtime-2.1` — long-turn probe ×3 | 3 | 0.100 |
| `gpt-realtime-2.1-mini` — 9-fixture set | 9 | 0.017 |
| `gpt-audio-1.5` — 9 wav + 9 mp3 + tool probe + repeats + long-turn ×6 | 30 | 0.140 |
| `gpt-audio` — 9-fixture set | 9 | 0.048 |
| `gpt-audio-mini` — 9-fixture set + repeats | 11 | 0.015 |
| web research | — | 0.000 |
| **TOTAL** | **~130** | **≈ $0.74** |

**Total spent: ≈ $0.74 USD — 49% of the $1.50 ceiling.** No call was refused, rate-limited, or
5xx'd. The ceiling was never the binding constraint.

---

## 9 · Recommendation

# → **(A) — Realtime API, audio in / text out, on `gpt-realtime-2.1`.**

**The evidence SUPPORTS D-28's default rather than overturning it — but not for D-28's stated
reason, and the accuracy case is genuinely close.**

**On the three judged criteria the two are near-tied:**

| | (A) `gpt-realtime-2.1` | (B) `gpt-audio-1.5` | winner |
|---|---|---|---|
| **Catches the mistakes** | 5/7, **0 hallucinations** | 5/7, **0 hallucinations** | **tie** |
| **Latency per turn** | ≈ 2.43 s (2–4 s band) | ≈ 2.80 s (2–4 s band) | (A), narrowly |
| **Cost / 10-min conversation** | **$0.283** | $0.340 | **(A), by 17%** |

D-28 says *"default to (A) where they are close."* **They are close — and (A) also happens to win
both tiebreakers it did not expect to.** The operator's ear ("it listens very well") is corroborated
rather than contradicted: (A) was the only configuration that caught **all four** grammar and
word-choice errors with zero hallucinations.

**The three findings that actually decide it:**

1. **(B)'s listening leg has a reproducible blind spot on the most canonical Italian error there
   is.** Every `gpt-audio` model missed `"ho andato"` in 9 of 9 attempts, with the correct answer
   written verbatim in its own prompt. A tutor for advanced Italian that cannot hear
   auxiliary-choice errors is not doing its job. Both Realtime models caught it every time.
2. **Taking the reply as text inverts the cost argument that motivated D-26.** Realtime was
   expensive because of $64/1M audio *output*. Remove that leg and (A) is **cheaper** than (B) —
   and (A)'s prompt cache (96%+ hit rate, measured) keeps it cheap while (B) got **zero** cache
   hits on ~50 calls.
3. **(B)'s "deletes all of it" simplification is smaller than it looks.** It removes ~510 lines
   and 7 concepts, but adds 4 — and one of them, browser-side turn detection, is harder than
   anything it deletes, and its failure mode is *manufacturing false corrections*, the one thing
   `PRECISION_CORE_LINES` forbids. D-26's rule that subtraction wins ties does not clearly apply
   when the subtraction is this conditional.

**Where (B) is genuinely better, and it should be recorded:** `gpt-audio-1.5` caught **both**
tractable pronunciation fixtures and **labelled them `pronunciation`** with correct phonetic
explanations; (A) caught one and filed it as `vocabulary`. If the tutor's pronunciation sense ever
becomes the deciding axis, this result should be revisited. Today it does not decide, because D-21
already routes phone-level scoring to Azure PA and restricts the LLM to *flagging suspects*.

**If the evidence had been closer still, the tiebreaker I would use** is the one this spike did not
have to reach: **which transport keeps the whole conversation in earshot.** (A) carries prior turns
as *audio* into every judgment, cheaply, because they cache. (B) hears one utterance at a time and
can only remember in text. For a product whose founding claim is that a transcript erases the
signal, a tutor whose memory *is* a transcript is the wrong shape.

**Conditions attached to choosing (A):**

1. **Verify the WebRTC leg end-to-end in a browser before building on it.** Text-only output is
   proven on the WebSocket and through the mint (HTTP 200); the WebRTC path is inferred, not
   measured (§0).
2. **Consider replacing WebRTC with a browser WebSocket** (§6). With no downstream audio track,
   WebRTC's job is gone — this deletes ~90 lines and 3 concepts *while keeping (A)'s advantages*,
   and captures much of what (B) was chosen for.
3. **Add `output_modalities` to `MINT_SESSION_WIRE_FIELDS`** (`lib/tutor/mint.ts:52`). It is
   currently absent, so the mint would silently drop it and the session would default to `["audio"]`
   — the exact defect D-28 exists to remove, arriving silently.
4. **Pin `gpt-realtime-2.1` (flagship). Do not use `gpt-realtime-2.1-mini`** — 3 empty replies and
   2 hallucinations out of 9 (§3.1). The `REALTIME_TIERS` switch in Settings offers the user a
   model this spike measured as unfit for the tutor's core job.
5. **Fix the rates before shipping** (§5.6): the realtime path needs **text**-token rates (`$4/1M`
   in, `$0.40/1M` cached, **`$24/1M` out**) — `REALTIME_RATES` has none, and
   `realtimePerMinuteUsd` currently over-books 5.1× by charging for audio output that will never
   be generated. Plus the two standing defects D-28 already ruled not-optional: the
   `RESERVATION_STALE_MS` overbill and the per-character TTS unit.
6. **Fix `gpt-audio-mini`'s ledgered rate regardless of this decision** (§5.6): at $0.006/audio-min
   it is under-priced **on the analysis path today**, where it triages every segment of every
   capture.
7. **Add `"vocabulary and word choice"` to `CATEGORY_ALIASES`** (§3.2). The shared prompt teaches a
   label the shared parser rejects, and rejection loses a whole segment's findings — **a live bug
   on the Record path**, independent of the tutor.

---

## Sources

All retrieved **2026-07-25**.

- [OpenAI pricing](https://developers.openai.com/api/docs/pricing) — `gpt-realtime-2.1` and
  `-2.1-mini` per-token rates, broken out by text/audio and cached/fresh.
- [Realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations)
  — `output_modalities`, VAD, `semantic_vad`, function calling.
- [Realtime guide](https://developers.openai.com/api/docs/guides/realtime) — session schema, transports.
- [gpt-realtime model page](https://developers.openai.com/api/docs/models/gpt-realtime) — legacy
  snapshot rates (text out $16/1M; superseded by the pricing page's $24/1M for 2.1).
- [gpt-audio](https://developers.openai.com/api/docs/models/gpt-audio),
  [gpt-audio-mini](https://developers.openai.com/api/docs/models/gpt-audio-mini),
  [gpt-realtime-mini](https://developers.openai.com/api/docs/models/gpt-realtime-mini) — model pages;
  note audio-token rates are absent from the two mini pages.
- Secondary corroboration of mini realtime audio rates ($10/$0.30/$20 per 1M):
  [MarkTechPost](https://www.marktechpost.com/2026/07/06/openai-gpt-realtime-2-1-mini-reasoning-realtime-api/),
  [layer3labs](https://www.layer3labs.io/guides/openai-realtime-api-pricing) — agree with the
  figures already in `rates.ts`.
- In-repo: `DECISIONS.md` (D-3, D-13, D-20, D-21, D-26, D-28), `lib/mistakes.ts`,
  `lib/analysis/rates.ts`, `lib/analysis/prompts.ts`, `lib/analysis/audio-model.ts`,
  `lib/analysis/findings.ts`, `lib/tutor/*`, `docs/research/spike-5-voice-loop.md`.

## Appendix — reproducing this

Harness in `…/scratchpad/spike-6/`: `probe.js` (the §0 modality probe), `gen-fixtures.sh` +
`fixtures.json` (the labelled set), `prompt.js` (builds the shared instruction from
`lib/mistakes.ts` — no duplicated wording), `run-a.js` (Realtime, one session per fixture, 1×-paced
audio), `run-a-multiturn.js` (one warm session, several turns — the §5.5 cache data),
`run-b.js` (chat/completions, streaming, `FMT=wav|mp3`, `TOOLMODE=1`), and `results-*.json` with
every raw reply and `usage` object. Requires `ws` (installed into the scratchpad, not the repo) and
system `ffmpeg`/`ffprobe`.

**The perishable artifact is `audio/` — the 9 labelled fixtures plus the isolated-word validation
clips.** The scratchpad is session-scoped and may be garbage-collected. If this test set is ever to
be re-run as a regression (and it should be, against *real* learner audio per §2.1), copy those
files somewhere durable first.
