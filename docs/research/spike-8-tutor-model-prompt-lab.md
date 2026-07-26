# Spike 8 — Tutor model and prompt lab

Date: 2026-07-26 · Live spend: **$0.636831** modelled/usage-derived · Hard ceiling: **$1.50**

## Method

Five labelled Italian sentences were synthesized once with gpt-4o-mini-tts/coral; G1–G3 contain planted grammar or word-choice errors and C1–C2 are correct controls. The same MP3 was sent through gpt-4o-transcribe → gpt-5.6-terra and decoded to 24 kHz PCM16 for gpt-realtime-2.1. Every successful parsed reply used the same streaming gpt-4o-mini-tts/coral output leg. Realtime and Terra each received one bounded repair after invalid structured output.

Latency is capture-commit to first TTS provider audio, not playback completion. Realtime/Terra costs are usage-derived where usage was available; STT and TTS are modelled from measured duration/bytes at the repository's conservative rates. The harness would stop before any cell whose $0.03 reserve could cross $1.50.

These are synthetic TTS fixtures. They prove plumbing and provide controlled comparative observations; they do **not** represent hesitant real learners, preserve natural pronunciation variation, or justify crowning a winning architecture or preset.

## Results

| Fixture | Architecture | Preset | Caught | Missed | False correction | Parse failure | First audio ms | Cost USD | Error categories |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| G1 | native | record-equivalent | no | yes | — | yes | — | 0.038548 | none |
| G2 | native | record-equivalent | no | yes | — | yes | — | 0.020340 | none |
| G3 | native | record-equivalent | no | yes | — | yes | — | 0.022204 | none |
| C1 | native | record-equivalent | — | — | — | yes | — | 0.018124 | none |
| C2 | native | record-equivalent | — | — | — | yes | — | 0.020700 | none |
| G1 | native | minimal | no | yes | — | yes | — | 0.019892 | none |
| G2 | native | minimal | no | yes | — | yes | — | 0.017548 | none |
| G3 | native | minimal | no | yes | — | yes | — | 0.019316 | none |
| C1 | native | minimal | — | — | — | yes | — | 0.013508 | none |
| C2 | native | minimal | — | — | — | yes | — | 0.013468 | none |
| G1 | native | balanced | no | yes | — | yes | — | 0.020465 | none |
| G2 | native | balanced | no | yes | — | yes | — | 0.022044 | none |
| G3 | native | balanced | no | yes | — | yes | — | 0.019748 | none |
| C1 | native | balanced | — | — | — | yes | — | 0.016001 | none |
| C2 | native | balanced | — | — | — | yes | — | 0.018164 | none |
| G1 | native | precision | no | yes | — | yes | — | 0.019768 | none |
| G2 | native | precision | no | yes | — | yes | — | 0.020976 | none |
| G3 | native | precision | no | yes | — | yes | — | 0.014637 | none |
| C1 | native | precision | — | — | — | yes | — | 0.018600 | none |
| C2 | native | precision | — | — | — | yes | — | 0.020464 | none |
| G1 | native | current | no | yes | — | yes | — | 0.022228 | none |
| G2 | native | current | no | yes | — | yes | — | 0.023044 | none |
| G3 | native | current | no | yes | — | yes | — | 0.022532 | none |
| C1 | native | current | — | — | — | yes | — | 0.020590 | none |
| C2 | native | current | — | — | — | yes | — | 0.019840 | none |
| G1 | transcript | record-equivalent | yes | no | — | no | 4088 | 0.011109 | grammar |
| G2 | transcript | record-equivalent | yes | no | — | no | 4731 | 0.004235 | vocabulary |
| G3 | transcript | record-equivalent | no | yes | — | no | 4591 | 0.003775 | idiom |
| C1 | transcript | record-equivalent | — | — | no | no | 3130 | 0.003591 | none |
| C2 | transcript | record-equivalent | — | — | no | no | 3140 | 0.003358 | none |
| G1 | transcript | minimal | yes | no | — | no | 4032 | 0.008538 | grammar |
| G2 | transcript | minimal | no | yes | — | no | 2493 | 0.003065 | none |
| G3 | transcript | minimal | no | yes | — | no | 3085 | 0.003698 | phrasing |
| C1 | transcript | minimal | — | — | no | no | 2833 | 0.002439 | none |
| C2 | transcript | minimal | — | — | no | no | 2974 | 0.003138 | none |
| G1 | transcript | balanced | yes | no | — | no | 3808 | 0.009992 | grammar |
| G2 | transcript | balanced | no | yes | — | no | 3202 | 0.004681 | grammar |
| G3 | transcript | balanced | no | yes | — | no | 3063 | 0.003807 | phrasing |
| C1 | transcript | balanced | — | — | no | no | 3150 | 0.003591 | none |
| C2 | transcript | balanced | — | — | no | no | 4195 | 0.003087 | none |
| G1 | transcript | precision | yes | no | — | no | 6530 | 0.010013 | grammar |
| G2 | transcript | precision | no | yes | — | no | 4075 | 0.004563 | grammar |
| G3 | transcript | precision | no | yes | — | no | 2993 | 0.004425 | idiom |
| C1 | transcript | precision | — | — | no | no | 4868 | 0.003549 | none |
| C2 | transcript | precision | — | — | no | no | 3334 | 0.003351 | none |
| G1 | transcript | current | yes | no | — | no | 3693 | 0.012055 | grammar |
| G2 | transcript | current | no | yes | — | no | 3692 | 0.005700 | grammar |
| G3 | transcript | current | no | yes | — | no | 3323 | 0.004229 | idiom |
| C1 | transcript | current | — | — | no | no | 5151 | 0.003262 | none |
| C2 | transcript | current | — | — | yes | no | 3007 | 0.005928 | grammar |

## Observed outcomes

- Native Realtime completed every audio-in/text-out request, but all 25 cells still failed the strict JSON boundary after one repair. No invalid result reached TTS, so first-audio latency is truthfully unavailable for those cells; their resolved Realtime usage remains charged.
- Transcript/Terra parsed in 25/25 cells. It caught G1 in 5/5 presets, matched the Record category for G2 in 1/5, and did not match the Record category for G3 in 0/5. Several G2/G3 cells did identify an issue under a different category, which remains a category-policy miss in this controlled label.
- Transcript controls produced one false correction in 10 cells. Successful transcript cells reached first TTS provider audio in 2.493–6.530 seconds.
- The matrix is evidence of a strict-output compatibility problem in the Native path and category drift in the Transcript path, not evidence that transcript-based listening is better for real learners.

## Prompt hashes

- native/record-equivalent: `e287a94decd1b4295dc621bd9fab833cd08e014788ef5d6e441b3f00581d192c`
- native/minimal: `500c12e31c7aff23dd7d74b8be516ec4e8862e7a863a21a80aa7099b1949a245`
- native/balanced: `3457958ceea6c49e8956bb1a5f6eb293af384090b3c42f4d084ae79ec8004f5b`
- native/precision: `7c1976dcff9204294ab829b58c0688e5219d6db59344b05652d43e47128a83d0`
- native/current: `41eb59009508d9a7f32329c114ecabdd19693b9461869fe5660849fe38efd0ac`
- transcript/record-equivalent: `89292677ad70c839e731ea46d48a472b1297064d68a137e3bf2ef6064306d559`
- transcript/minimal: `2396d16fcbb2a377f043e6d71fdc87e2973b96d7bedfcb035a3a755eef259d3d`
- transcript/balanced: `3db4f80124093e0b88b7245bcad5d929ac4d6a589ea0d1c4513cf0ff3fd72429`
- transcript/precision: `2e096d5e9fdb72c76a38ec8c60eb95cd66b3130eab811b9711927bd9060e2c5c`
- transcript/current: `ae18b62296ffd3b49f0465bc4fcf0922fc011a14af00ee0f509a86131dcbc2db`

## Contract facts

- Native: gpt-realtime-2.1, GA `/v1/realtime`, `output_modalities: ["text"]`, `turn_detection: null`, one `input_audio_buffer.commit` then one `response.create`.
- Transcript: gpt-4o-transcribe with `language=it`, then gpt-5.6-terra Responses API with `reasoning: { effort: "low" }` and strict `text.format.type: "json_schema"`.
- Common output: gpt-4o-mini-tts, `response_format: "mp3"`, `stream_format: "sse"`, voice `coral`.

## Interpretation limit

The matrix is retained as operator evidence, including misses, false corrections, and parse failures. No winner is selected. Human use with spontaneous, hesitant speech remains the decision input.
