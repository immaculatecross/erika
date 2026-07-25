import { describe, expect, it } from "vitest";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";
import { openAiSpeechToText, openAiTextToSpeech, STT_MODEL } from "@/lib/voice/openai-speech";
import { TTS_MODEL_SNAPSHOT, ttsAudioSecondsFromMp3Bytes } from "@/lib/analysis/rates";
import { OPENAI_TUTOR_VOICE_IDS, TUTOR_VOICE_CHOICES } from "@/lib/voice/voices";

// OBS-001 — THE CHEAPEST POSSIBLE REAL CALL PER INTEGRATION. Owed since v0.5.
//
// Skipped entirely without `OPENAI_API_KEY`, so CI and every contributor without a key
// run exactly as before. With a key, each test makes ONE real request and asserts only
// that the response PARSES — never that a model said anything in particular, which
// would be a flaky assertion about a stochastic system.
//
// WHY THESE EXIST AT ALL, in this repo's own words: "no path in this app has ever run
// against a live API", and the v0.6 tutor bug — a fabricated `maxSessionSeconds` field
// that 400'd OpenAI and broke the tutor in real use while CI stayed green — is the
// proof that a mock cannot catch contract drift. Three integrations, three smokes:
// the Realtime mint (the listening leg's front door), TTS (the speaking leg), and STT
// (D-21's scripted-answer leg, which E-45/E-46 will import).
//
// Cost per full run is a fraction of a cent: one mint (no session is ever opened), one
// two-word synthesis, one transcription of that same clip.

const KEY = process.env.OPENAI_API_KEY;
const live = KEY ? describe : describe.skip;

/** A sentence short enough to be nearly free and long enough to be real Italian. */
const PHRASE = "Buongiorno, come stai?";

live("live: the Realtime mint accepts this product's own session (the listening leg)", () => {
  it("mints an ephemeral secret for an audio-in / TEXT-out session", async () => {
    // The exact body the product sends, built by the product's own allowlist — not a
    // hand-written approximation, which is how the mint-body bug survived review.
    const wire = buildMintSessionWireBody({
      type: "realtime",
      model: "gpt-realtime-2.1",
      instructions: "Rispondi in italiano.",
      output_modalities: ["text"],
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
      },
      tools: [],
      tool_choice: "auto",
      maxSessionSeconds: 1800,
    });
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ session: wire }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value?: string; expires_at?: number; session?: Record<string, unknown> };
    expect(typeof body.value).toBe("string");
    expect(body.value?.startsWith("ek_")).toBe(true);
    // The gating fact of this whole milestone, re-checked live: text-only output is
    // accepted and echoed back, not silently downgraded to the ["audio"] default.
    expect(body.session?.output_modalities).toEqual(["text"]);
  }, 30_000);
});

live("live: TTS speaks (the speaking leg)", () => {
  it("synthesizes real Italian in the operator's default voice and returns mp3", async () => {
    const tts = openAiTextToSpeech("female");
    expect(tts.voice).toBe(OPENAI_TUTOR_VOICE_IDS.female);
    const speech = await tts.synthesize({ text: PHRASE, language: "it" });
    expect(speech.mimeType).toBe("audio/mpeg");
    expect(speech.audio.byteLength).toBeGreaterThan(1_000);
    expect(speech.source).toContain(TTS_MODEL_SNAPSHOT);
    // The mp3 is constant-bitrate, which is what lets the speak route charge the
    // honest duration without ffprobe. A plausible duration for two words is 0.5–6 s;
    // a wildly different figure means the bitrate assumption has moved and the
    // finalized charge would be wrong.
    const seconds = ttsAudioSecondsFromMp3Bytes(speech.audio.byteLength);
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(6);
  }, 60_000);

  it("streams, and its SSE decodes to the same audio", async () => {
    // Streaming is mandatory, not an optimization (spike-5 §4), so its contract gets
    // the same live check as the blocking one.
    const tts = openAiTextToSpeech("male");
    expect(tts.voice).toBe(OPENAI_TUTOR_VOICE_IDS.male);
    let bytes = 0;
    let chunks = 0;
    for await (const chunk of tts.synthesizeStream!({ text: PHRASE, language: "it" })) {
      bytes += chunk.byteLength;
      chunks += 1;
    }
    expect(chunks).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(1_000);
  }, 60_000);

  it("offers exactly the two voices the operator chose, and both are real", async () => {
    expect([...TUTOR_VOICE_CHOICES]).toEqual(["female", "male"]);
    expect(Object.values(OPENAI_TUTOR_VOICE_IDS).sort()).toEqual(["alloy", "nova"]);
  });
});

live("live: STT transcribes a scripted answer (D-21's allowance only)", () => {
  it("parses a transcription of a known phrase", async () => {
    // ⚠️ This is a SCRIPTED, KNOWN-ANSWER check — the only thing STT is allowed to do
    // in this product (D-3, D-28). It is never used for free-spoken error detection:
    // spike-6 §2.2 measured `whisper-1` silently repairing this repo's own planted
    // errors. The phrase is synthesized here so the test needs no fixture on disk.
    const speech = await openAiTextToSpeech("female").synthesize({ text: PHRASE, language: "it" });
    const transcript = await openAiSpeechToText.transcribe({
      audio: speech.audio,
      mimeType: "audio/mpeg",
      language: "it",
    });
    expect(transcript.source).toContain(STT_MODEL);
    expect(typeof transcript.text).toBe("string");
    expect(transcript.text.toLowerCase()).toContain("buongiorno");
    // `verbose_json` is a hard 400 on this model, so no caller may require segments.
    expect(transcript.segments).toBeUndefined();
  }, 90_000);
});
