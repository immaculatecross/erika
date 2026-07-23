# Spike 3 — Richer extraction, pronunciation fidelity, and the tutor stack

*Research spike, 2026-07-23. Prices verified against provider pages this day. READ-ONLY spike; no repo changes.*

## Question

Under the new SPEND MORE posture: (1) what is the current audio-model lineup and price; (2) can audio LLMs judge phone-level Italian pronunciation or do we need a dedicated API; (3) does Realtime beat batch chat for stored audio; (4) what extraction policy maximizes signal per capture type; (5) what stack powers the Learn-tab tutor; (6) which TTS.

## Recommendation

1. **Keep the OpenAI gpt-audio family — it is still current.** `gpt-audio-1.5` ($32/1M audio-in ≈ $0.019/min) and `gpt-audio-mini` ($10/1M ≈ $0.006/min) remain OpenAI's chat-audio lineup; nothing newer replaced them (the 2026 releases are Realtime-side). Recalibrate `rates.ts`: the deep model really costs ~$0.02/min, not $0.06 — the richness dial is 3× cheaper than the ledger believes.
2. **Richness dial:** captures ≤30 min skip triage — 100% deep-listen at native speed with an enriched prompt (pronunciation observations, register/colto upgrades, disfluencies) ≈ **$0.22 per 10-min capture** (~2× today, still trivial). Day-dumps keep the cascade with the triage prompt loosened toward flag-rate ~0.5 ≈ **$1.77 per 12-h dump**; optionally route deep calls through the Batch API (−50%).
3. **Pronunciation: hybrid.** Audio LLMs are unreliable at phone level (evidence below) — let the deep pass *flag suspects* (gemination, vowel aperture, stress) and score the re-record drill with **Azure Pronunciation Assessment** (it-IT supported, phoneme-level scores, ~$1/audio-hour — cents/month). SpeechAce and ELSA have no Italian. Scripted PA scores a known drill text — it is not D-3's banned STT-for-error-detection.
4. **Realtime offers no extraction advantage for stored files** — same models, same audio-token price, minus Batch discounts, plus session machinery. Refuted; keep batch chat.
5. **Tutor:** `gpt-realtime-2.1-mini` over WebRTC (ephemeral token from a Next.js route), system prompt built from `lib/analysis/profile.ts` + slips, a `log_evidence` function tool during the call, record audio client-side and feed it back through normal ingest + deep analysis. **≈ $0.37/day ≈ $11/month** for a daily 10-min habit (flagship: ≈ $21).
6. **TTS: keep `gpt-4o-mini-tts`** (still OpenAI's default TTS, multilingual, $0.60/1M text-in + $12/1M audio-out ≈ $0.015/min); add an `instructions` field ("native Italian, clear, unhurried") and fix `rates.ts`'s unit (it bills per-token, not per-character).

## Options & cost tables

### 1 · Audio-understanding lineup (verified 2026-07-23)

| Model | Text in/out /1M | Audio in/out /1M | ≈ $/audio-min in | Endpoints |
|---|---|---|---|---|
| gpt-audio-1.5 | $2.50 / $10 | $32 / $64 | $0.0192 | chat, responses, realtime, **batch** |
| gpt-audio (fallback) | $2.50 / $10 | $32 / $64 | $0.0192 | chat, responses |
| gpt-audio-mini (2025-12-15) | $0.60 / $2.40 | $10 / $20 | $0.006 | chat, responses, realtime, batch |
| gpt-realtime-2.1 | $4 / $24 | $32 / $64 (cached in $0.40) | $0.0192 | realtime |
| gpt-realtime-2.1-mini | — | $10 / $20 (cached in $0.30) | $0.006 | realtime |

Audio ≈ 600 tokens/min in, ~1,200/min out. No `gpt-audio-2` exists; the May-2026 wave (gpt-realtime-2 gen, -translate $0.034/min, -whisper $0.017/min) is Realtime/transcription only. **Gemini cross-check** (no switch planned): audio tokenized at 32 tok/s (1,920/min); Gemini 2.5 Flash audio-in $1.00/1M ≈ **$0.0019/min** (~10× cheaper), 3.1 Flash-Lite $0.50/1M, Live API native audio $3/$12 per 1M. OpenAI is the premium option; we pay it for continuity and D-3-verified quality.

### 2 · Pronunciation scoring options

| Option | Italian | Phone-level | Price | Verdict |
|---|---|---|---|---|
| Audio-LLM judgment alone | yes | unreliable (see Evidence) | in deep pass | suspects only |
| Azure PA | **it-IT** (33+ locales) | phoneme *scores* (names/NBest en-US-only; prosody en-US-only) | = STT standard, ~$1/audio-hr | **score the drill** |
| SpeechAce | **no** (en/fr/es only) | — | — | out |
| ELSA API | **no** (English only) | — | — | out |

### 3 · Extraction policies

| Policy | 10-min clean capture | 12-h dump (2 h speech) |
|---|---|---|
| A — today's cascade (1.4× triage, ~30% flagged) | ≈ $0.11 | ≈ $1.26 |
| **B — rich: skip triage, 100% deep native + enriched prompt** | **≈ $0.22** | ($2.40 — rejected for dumps) |
| B+ — second pronunciation-focused deep pass | ≈ $0.45 | — |
| **A′ — dump cascade, loosened triage (~50% flagged)** | — | **≈ $1.77** (≈ $1.19 with Batch −50% on deep) |

Daily 10-min capture on B ≈ $6.50/mo; two dumps/week on A′ ≈ $15/mo.

### 4 · Tutor (10 min/day)

| Stack | Per session | Per month |
|---|---|---|
| gpt-realtime-2.1-mini + deep re-analysis | ≈ $0.16 + $0.21 | ≈ $11 |
| gpt-realtime-2.1 + deep re-analysis | ≈ $0.50 + $0.21 | ≈ $21 |

Latency: ~500–800 ms voice-to-voice typical; the 2.1 generation claims <200 ms machine-side. **WebRTC from the browser** (mic capture, jitter handling, ephemeral key minted server-side); WebSocket is for server-to-server. Session pattern: `session.update` instructions carry knowledge targets (profile + active slips); a `log_evidence` function tool captures `{type: error|success, quote, target}` server-side during the call as structured evidence; the recorded conversation audio is saved as a normal Erika session → ingest → deep analysis → findings like any capture (tool events become drill hints, findings remain the one truth per E-17).

## Evidence

- Lineup/prices: [gpt-audio-1.5 model page](https://developers.openai.com/api/docs/models/gpt-audio-1.5), [gpt-audio-mini model page](https://developers.openai.com/api/docs/models/gpt-audio-mini), [OpenAI pricing](https://developers.openai.com/api/docs/pricing) (shows gpt-realtime-2.1/-mini $32/$64 and $10/$20, batch $16 rows), [CloudPrice gpt-audio-mini](https://cloudprice.net/models/openai-gpt-audio-mini) ($10/$20 audio), [per-minute math](https://www.layer3labs.io/guides/openai-realtime-api-pricing) (600/1,200 tok/min, $0.50 per 10-min call), [May-2026 voice announcement](https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/), [gpt-realtime-2.1-mini release](https://www.marktechpost.com/2026/07/06/openai-gpt-realtime-2-1-mini-reasoning-realtime-api/).
- Gemini: [pricing](https://ai.google.dev/gemini-api/docs/pricing), [audio docs](https://ai.google.dev/gemini-api/docs/audio) (32 tok/s).
- Phone-level reliability: zero-shot speech-LLM on Speechocean762 — word/sentence fine, **phoneme-level weak** (Spearman ≈ 0.6) ([Radboud](https://repository.ubn.ru.nl/bitstream/handle/2066/322327/322327.pdf?sequence=1)); GPT-4o multi-granularity study — utterance OK, phoneme poor ([arXiv 2503.11229](https://arxiv.org/html/2503.11229)); **stereotype-driven diagnosis** — in 39.6% of judged cells audio LLMs gave coherent reasoning for a *wrong* rating, diagnosing from L1 priors over acoustics ([arXiv 2606.15325](https://arxiv.org/html/2606.15325)) — exactly the gemination/vowel trap for "English speaker in Italian."
- Azure PA: [how-to](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment) (granularity `Phoneme` returns full-text/word/syllable/phoneme scores; phoneme *names*/NBest and prosody en-US-only; billed at STT rate), [it-IT in supported locales](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment), [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/).
- SpeechAce [languages](https://api-docs.speechace.com/getting-started/supported-languages) (en/fr/es only); ELSA [API](https://elsaspeak.com/en/elsa-api/) (English only).
- Realtime: [guide](https://developers.openai.com/api/docs/guides/realtime) (WebRTC/WebSocket/SIP; ephemeral tokens; function calling), [latency](https://thepromptbench.com/voice-and-realtime/latency-budgets-for-realtime-voice/), [huuphan on 2.1](https://www.huuphan.com/2026/07/low-latency-voice-api-2-1.html). Same audio-token prices as chat; no batch path in a live session; nothing in the docs claims better acoustic fidelity — refutation stands.
- TTS: [gpt-4o-mini-tts model page](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) ($0.60/1M text-in, $12/1M audio-out, "Default" TTS, snapshot 2025-12-15, no successor).

## Risks & unknowns

- **it-IT phoneme output shape**: phoneme *scores* confirmed; phoneme *names*/NBest are en-US-only, so drill scoring should target reference-text minimal pairs ("pala"/"palla") and read positional phoneme scores. Prototype before committing E-8's UI.
- Azure "$1/audio-hour" is the nominal standard rate — confirm region/tier at implementation; a new provider key breaks the "one secret" simplicity (`.env.local` gains `AZURE_SPEECH_KEY/REGION`; PA spend must enter the same `spend_ledger`).
- 600 tok/min is empirical, not an OpenAI-published constant — recalibrate `rates.ts` from real `usage` after the first rich run (the machinery already anticipates this).
- Enriched prompt widens output: raise deep max-tokens or the E-16b truncation repair will fire more; register/disfluency observations may not fit `isCategory` — either extend categories (migration) or a `notes` side-channel.
- Batch API for audio: endpoint support is listed, but base64-JSONL size limits and 24-h turnaround need a probe; it is an optimization, not a dependency.
- Stereotype risk cuts both ways: the profile-primed prompt (E-19) may *increase* prior-driven pronunciation claims — the Azure-scored drill is the corrective.

## Milestone implications

- **New DECISIONS entry** (extends D-10): the richness dial — spend posture, per-source policy, and the hybrid pronunciation stance (D-3 stands: PA scores known text, never detects errors in free speech).
- **E-8 pronunciation studio**: deep pass emits pronunciation suspects → re-record drill scored by Azure PA it-IT; new rates entry + ledger integration (lease-before-spend, per E-21/E-23 discipline).
- **Richness dial in `lib/analysis/`**: policy switch on session duration/source in `cascade.ts`; enriched `deepPrompt` variant; `rates.ts` recalibration; `ANALYSIS_FLAG_RATE` default toward 0.5 for dumps.
- **E-10 conversation gym / Learn tab**: realtime-mini WebRTC session + evidence tool + post-session re-analysis; findings flow through `findings-model.ts` unchanged.
- **E-21 render engine**: keep model; add `instructions`; fix the character-vs-token rate unit.
