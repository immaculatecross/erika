# Spike 1 — Speaker filtering, throughput, and the spend-more cost model

Date: 2026-07-23 · Repo read at `b4c9038` (v0.3 complete). Research spike only — no code changed.

## Question

Under the new posture (spend more for richer extraction; bystanders never analyzed; recall on the user's own speech paramount): (1) how to filter user-vs-others per VAD segment from a 30–60 s enrollment sample; (2) how a 12 h dump processes in roughly constant wall-clock inside the existing worker/lease architecture; (3) what a 12 h dump actually costs under current OpenAI audio pricing across three cascade postures; (4) one architecture plus a fallback.

## Recommendation

Go **local**: speaker verification via `sherpa-onnx-node` + a CAM++/WeSpeaker embedding model (~29 MB, 0.71–0.87 % clean EER; official Node `SpeakerEmbeddingExtractor`) — the only option where bystander audio never leaves the device. **Enrollment:** one guided ~45 s onboarding take under `data/enrollment/` (gitignored), centroid embedding in a new `enrollment` table (one migration). **Placement:** a new checkpointed ingest stage `attributing` between `segmenting` and `rendering`; score 3–5 s sliding windows per segment (segments reach 240 s, can mix speakers), segment score = max window cosine, persisted on `segments`. **Threshold, recall-first:** drop only confident-non-user; uncertain flows through; τ calibrated against a committed labelled two-speaker fixture in the D-13 pattern (user recall ≥ 0.99, fixture falsifies a naive threshold). Excluded audio is flagged, never deleted. **Parallelism:** per-segment pool of N≈6 inside `runAnalysisJob`, spend *reservations* (lease-before-spend) replacing check-then-call budgeting, interval heartbeat, bounded 429 backoff — a 12 h dump lands in ~10–20 min. **Posture:** lower the triage flag threshold (~$2.0–2.7/dump); deep-everything ($2.7–3.6) behind a setting, cap ~$120/mo. **Fallback:** session-level clustering of the same embeddings (user = cluster nearest enrollment); still unsure → fail open to analyze-everything. Hosted speaker-ID only ever opt-in.

## Options & costs

### 1. User-vs-others filtering

| Option | Accuracy expectation | Integration | Privacy | Cost |
|---|---|---|---|---|
| **sherpa-onnx-node + CAM++/WeSpeaker (recommended)** | 0.71–0.87 % EER VoxCeleb1-O clean; plan 3–8× worse (~3–8 % EER) far-field | Native npm addon, `SpeakerEmbeddingExtractor`/`SpeakerEmbeddingManager` exposed in Node; bundles kaldi fbank; one new ingest stage | Fully local | $0/run; ~29 MB model; well under real time on CPU |
| Raw ONNX via onnxruntime-node | Same models | You reimplement kaldi fbank in JS (SpeechBrain ECAPA export is known-awkward: STFT not exportable) | Local | Buys nothing over sherpa-onnx |
| pyannote Python sidecar | embedding model 2.8 % EER (weaker); diarization DER 11–21 % | New Python runtime + gated HF models; ops cost | Local | Worse accuracy than CAM++, more moving parts |
| Hosted: **pyannoteAI** (voiceprints ≤30 s, language-agnostic, confidence 0–100) | Vendor-claimed best DER on 10 domains | Simple REST | **Bystanders leave device** | ~€1.56/12 h + plan min €19/mo |
| Hosted: **Speechmatics** (enrolled IDs from 5–30 s clips, Italian `it` supported) | n/a public | Simple REST | Same problem | ~$1.55/12 h (Melia) |
| Hosted: AssemblyAI / Deepgram / Gladia | Diarization only — **no voice-enrollment ID** (AssemblyAI's "speaker identification" is LLM name inference, not voiceprint) | — | Same problem | $2–8/12 h |

Cross-language note: enrollment and test are both Italian, so the dominant degradation is far-field acoustics, not language; still calibrate on Italian room audio, not English defaults.

### 2. Throughput — the concrete change

Today: one worker process (`scripts/worker.ts`), one job at a time, and `runAnalysisJob` (`lib/analysis/cascade.ts`) is a strictly **serial** per-segment for-loop (heartbeat per iteration; spend committed atomically with the segment witness by `persistSegmentFindings`; resume via content-hash witnesses).

**Change: a bounded per-segment pool of N≈6 (env `ANALYSIS_CONCURRENCY`) inside one analysis job.** Work scales with speech (VAD-bounded), not dump length: 12 h dump ≈ 90–120 min speech ≈ ~140 segments (≤240 s each, `MAX_SEGMENT_MS`); at ~25 s/call and N=6, deep-everything completes in ~10–20 min — roughly constant wall-clock. Rate limits are not the binding constraint: `gpt-audio-1.5` Tier 1 = 500 RPM / 30 k TPM (a deep call ≈ 1.7 k tokens ⇒ ≥ ~18 calls/min even on Tier 1; Tier 2 = 450 k TPM removes the ceiling).

Hazards and their fixes:
- **Budget race** — `wouldExceedBudget` is check-then-call; N in-flight calls can each pass before any records spend, overshooting the cap by up to N × max-call-cost. Fix: reserve estimated cost in a synchronous transaction *before* the call (pending ledger rows), count reservations in the budget check, finalize/release on completion — the E-21/E-23 lease-before-spend discipline applied to the cascade. Add a startup sweep for orphaned reservations (E-23's sweep pattern).
- **Heartbeat** — beaten only per loop iteration today; a pool with long in-flight calls could go stale and be reclaimed mid-run (re-bill risk). Fix: `setInterval` heartbeat every ~15 s while the job runs (stale threshold in `lib/jobs/lease-config.ts`).
- **Resume** — unchanged mechanics (per-segment witnesses), but crash exposure grows from 1 to N charged-but-unwitnessed calls (cents; bounded).
- **429s** — currently a non-2xx is `ModelUnavailableError` → model fallback → run failure. Add bounded jittered retry honoring `Retry-After` before falling through.
- **Progress** — increment from a completed counter, not the loop index. better-sqlite3 is synchronous, so each transaction stays atomic on the single JS thread.

### 3. Cost per 12 h dump (90–120 min speech post-VAD, ~140 segments, triage at 1.4×)

Verified pricing (2026-07): `gpt-audio-1.5` audio $32/M in · $64/M out, text $2.50/$10; `gpt-audio-mini` audio $10/M in · $20/M out, text $0.60/$2.40; `gpt-audio` (fallback) audio $32/$64. Audio input ≈ 10 tokens/s (600/min) ⇒ mini ≈ $0.006/audio-min, deep ≈ $0.0192/audio-min + ~$0.008 text-out per deep call (~$0.03 per speech-minute all-in).

| Posture | Triage | Deep-listen | **Total / 12 h dump** | Monthly (daily dump) |
|---|---|---|---|---|
| Current cascade (30 % flag) | $0.39–0.52 | 0.3×S ⇒ $0.81–1.08 | **$1.20–1.60** | ~$36–48 |
| Lowered triage threshold (60 % flag) | $0.39–0.52 | 0.6×S ⇒ $1.62–2.16 | **$2.00–2.70** | ~$60–80 |
| Deep-listen everything (no gate) | — | S ⇒ $2.70–3.60 | **$2.70–3.60** | ~$81–108 |

Note: `lib/analysis/rates.ts` ledgers deep at $0.06/min — ~2× the true ~$0.03/min all-in (mini's $0.006 is exact). Safe direction, but the cap halts runs early; recalibrate in the same PR that raises the cap.

## Evidence

- Repo: serial loop + witnesses (`lib/analysis/cascade.ts`), lease/heartbeat (`lib/jobs/lease.ts`), single-job worker (`scripts/worker.ts`), ingest stages `normalizing→detecting→segmenting→rendering` (`lib/ingest/pipeline.ts`), D-13 calibration pattern (`tests/ingest-vad-calibration.test.ts`, `tests/fixtures/make-labelled-speech.sh`).
- Pricing/limits: gpt-audio-1.5 official page (audio $32/$64; Tier 1 500 RPM/30 k TPM) https://developers.openai.com/api/docs/models/gpt-audio-1.5 · gpt-audio-mini text https://developers.openai.com/api/docs/models/gpt-audio-mini · mini audio $10/$20 https://cloudprice.net/models/openai-gpt-audio-mini corroborated by gpt-realtime-2.1-mini's identical audio rates https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini · gpt-audio audio $32/$64 https://openrouter.ai/openai/gpt-audio · ~600 audio tokens/min https://community.openai.com/t/confusion-between-per-minute-audio-pricing-vs-token-based-audio-pricing/1073222, https://induwara.lk/tools/ai-audio-token-cost-calculator
- Speaker models: sherpa-onnx models & Node API https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html, https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/test_speaker_identification.js, https://www.npmjs.com/package/sherpa-onnx · WeSpeaker EER (CAM++ 0.71–0.80 %, ResNet34 0.80–0.87 % Vox1-O) https://github.com/wenet-e2e/wespeaker/blob/master/examples/voxceleb/v2/README.md · far-field degradation: VOiCES ~3.3–4.0 % EER fused https://www.researchgate.net/publication/335830043, FFSVC 2022 3.0–6.2 % https://arxiv.org/abs/2209.11625, https://arxiv.org/abs/2209.05273 · pyannote https://huggingface.co/pyannote/speaker-diarization-3.1, https://huggingface.co/pyannote/embedding
- Hosted: pyannoteAI voiceprints/pricing https://docs.pyannote.ai/tutorials/identification-with-voiceprints, https://www.pyannote.ai/pricing · Speechmatics speaker ID https://docs.speechmatics.com/speech-to-text/features/speaker-identification, languages https://docs.speechmatics.com/introduction/supported-languages · AssemblyAI "speaker identification" is contextual, not voiceprint https://www.assemblyai.com/docs/speech-understanding/speaker-identification, https://www.assemblyai.com/pricing · Deepgram https://developers.deepgram.com/docs/diarization, https://deepgram.com/pricing · Gladia https://www.gladia.io/pricing

## Risks & unknowns

1. **Far-field EER is the big unknown** (3–8× clean); literature numbers come from fused challenge systems. Mitigations: max-over-windows scoring, conservative τ_drop (FRR≈0 target; a 20–40 % false-accept rate is acceptable — uncertain segments flow through by design), the clustering fallback, and a real-room labelled fixture before shipping.
2. Synthetic two-speaker fixtures can't fully falsify a *speaker* threshold the way pink-noise falsified VAD — the calibration fixture should use two real voices (operator + one consenting second speaker), committed like `labelled-speech.flac`.
3. gpt-audio-mini's audio-token price is not visible on OpenAI's own rendered docs page (JS tab); corroborated via two secondaries + class pricing. Recalibrate `rates.ts` against real `usage` from one run (the module's own stated intent).
4. Reservation-based budgeting adds a ledger state (`pending`); crash windows leave orphans — needs the startup sweep and tests in the atomicity suite.
5. One embedding model decides "confidently not the user": ship a kill-switch env (`SPEAKER_FILTER=off`) and surface excluded-segment counts in the session report so silent recall loss is visible.
6. Enrollment drift (illness, new mic/room): allow re-enrollment; store multiple enrollment embeddings and score against the max.

## Milestone implications

- This spike de-risks **E-13 (voice enrollment)** — promote it into v0.4 as: enrollment capture UI + `enrollment` table migration + `attributing` ingest stage + labelled-speaker calibration fixture (D-13 pattern) + excluded-segments UI.
- A separate small milestone: **cascade parallelism + spend reservations** (touches `cascade.ts`, `budget.ts`, `lease.ts` usage; Full review — it's a money path, same class as E-21).
- A one-PR chore: **recalibrate `rates.ts`** to verified prices and raise the default cap to match the chosen posture (~$120/mo for deep-everything).
- FEATURES/DECISIONS: record the privacy decision (local-only speaker filtering; hosted speaker-ID only ever opt-in) as a D-number — it forecloses vendor shortcuts later.
