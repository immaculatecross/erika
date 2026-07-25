import { TTS_MODEL_SNAPSHOT } from "../analysis/rates";
import { DEFAULT_TUTOR_VOICE, OPENAI_TUTOR_VOICE_IDS, type TutorVoiceChoice } from "./voices";
import { VoiceUnavailableError, type Speech, type SpeechToText, type TextToSpeech, type Transcript } from "./speech";

// The OpenAI implementations of the E-43 voice seam. The ONLY files that talk to
// api.openai.com for speech; everything above them sees parsed results. The key is
// read from the environment at call time, never logged, never returned.
//
// Model choices are spike-measured, not preferred:
//
//   * TTS — `gpt-4o-mini-tts-2025-12-15`. spike-5 §1 found the snapshot exists and
//     this repo pins snapshots on paths that bill. `stream_format: "sse"` is
//     supported ONLY by this family (not tts-1/tts-1-hd), and it is the whole
//     latency budget: 4.63 s blocking vs 0.844 s to first byte (spike-5 §4).
//   * STT — `gpt-4o-transcribe`. 0.00% WER on clean AND telephone-grade Italian, and
//     the fastest of the three measured (spike-5 §3). Note the honest caveat there:
//     the test audio was TTS output, so relative accuracy on REAL learner speech is
//     not established. And note the hard contract trap: asking this model for
//     `verbose_json` is a **400**, not a downgrade — so `segments` is never requested.

const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

export const STT_MODEL = "gpt-4o-transcribe" as const;

/** The mp3 container both the blocking and streaming TTS paths return. */
export const TTS_RESPONSE_FORMAT = "mp3";
export const TTS_MIME_TYPE = "audio/mpeg";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new VoiceUnavailableError("OPENAI_API_KEY is not set.");
  return key;
}

export function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ── text to speech ──────────────────────────────────────────────────────────

/**
 * Build the OpenAI TTS implementation for one voice choice. A FACTORY, not a
 * singleton: the caller (the speak route) resolves the learner's setting and passes
 * the result in, so no module-level value decides which voice anyone hears.
 */
export function openAiTextToSpeech(choice: TutorVoiceChoice = DEFAULT_TUTOR_VOICE): TextToSpeech {
  const voice = OPENAI_TUTOR_VOICE_IDS[choice];
  return {
    id: `openai:${TTS_MODEL_SNAPSHOT}:${voice}`,
    voice,
    isAvailable: hasOpenAiKey,

    async synthesize(input): Promise<Speech> {
      const res = await postSpeech(input, voice, false);
      const audio = new Uint8Array(await res.arrayBuffer());
      return { audio, mimeType: TTS_MIME_TYPE, source: `openai:${TTS_MODEL_SNAPSHOT}` };
    },

    async *synthesizeStream(input): AsyncIterable<Uint8Array> {
      const res = await postSpeech(input, voice, true);
      for await (const chunk of decodeSpeechSse(res)) yield chunk;
    },
  };
}

async function postSpeech(
  input: { text: string; style?: string; voice?: string },
  defaultVoice: string,
  stream: boolean,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(SPEECH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: TTS_MODEL_SNAPSHOT,
        input: input.text,
        voice: input.voice ?? defaultVoice,
        response_format: TTS_RESPONSE_FORMAT,
        // Omitted unless the caller asked for it — plain synthesis is the default
        // (the operator picked both plain samples; see lib/voice/speech.ts).
        ...(input.style ? { instructions: input.style } : {}),
        ...(stream ? { stream_format: "sse" } : {}),
      }),
    });
  } catch (err) {
    throw new VoiceUnavailableError(`Network error calling ${TTS_MODEL_SNAPSHOT}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceUnavailableError(`${TTS_MODEL_SNAPSHOT} call failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res;
}

/**
 * Decode `/v1/audio/speech` SSE into raw audio chunks. The stream carries
 * `{"type":"speech.audio.delta","audio":"<base64>"}` events terminated by a
 * `speech.audio.done` (spike-5 §4, measured). Exported so the decoder is unit-tested
 * against a fixture stream with no network — the contract, not the transport, is the
 * thing that has broken before.
 */
export async function* decodeSpeechSse(res: Response): AsyncIterable<Uint8Array> {
  const body = res.body;
  if (!body) throw new VoiceUnavailableError("TTS stream carried no body.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, cut).trim();
      buffered = buffered.slice(cut + 1);
      const chunk = speechDeltaBytes(line);
      if (chunk) yield chunk;
    }
  }
  const chunk = speechDeltaBytes(buffered.trim());
  if (chunk) yield chunk;
}

/** The audio bytes carried by one SSE line, or null when it carries none. */
export function speechDeltaBytes(line: string): Uint8Array | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  let event: { type?: string; audio?: string };
  try {
    event = JSON.parse(payload) as { type?: string; audio?: string };
  } catch {
    return null;
  }
  if (event.type !== "speech.audio.delta" || typeof event.audio !== "string") return null;
  return Uint8Array.from(Buffer.from(event.audio, "base64"));
}

// ── speech to text (D-21 scripted answers only — see lib/voice/speech.ts) ────

export const openAiSpeechToText: SpeechToText = {
  id: `openai:${STT_MODEL}`,
  isAvailable: hasOpenAiKey,

  async transcribe({ audio, mimeType, language }): Promise<Transcript> {
    const form = new FormData();
    form.append("model", STT_MODEL);
    // `verbose_json` is a hard 400 on this model (spike-5 §3), so `json` it is —
    // which is why `Transcript.segments` is optional and never populated here.
    form.append("response_format", "json");
    if (language) form.append("language", language);
    form.append("file", new Blob([audio as BlobPart], { type: mimeType }), `take.${extensionFor(mimeType)}`);

    let res: Response;
    try {
      res = await fetch(TRANSCRIPTION_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}` },
        body: form,
      });
    } catch (err) {
      throw new VoiceUnavailableError(`Network error calling ${STT_MODEL}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VoiceUnavailableError(`${STT_MODEL} call failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const data = (await res.json()) as { text?: unknown };
    return {
      text: typeof data.text === "string" ? data.text.trim() : "",
      source: `openai:${STT_MODEL}`,
    };
  },
};

/** A filename extension the upload can be labelled with, from its mime type. */
export function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  return subtype === "mpeg" ? "mp3" : subtype;
}
