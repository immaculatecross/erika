import { TTS_MODEL, TUTOR_STT_MODEL } from "../analysis/rates";
import {
  VoiceUnavailableError,
  type Speech,
  type SpeechToText,
  type TextToSpeech,
  type Transcript,
} from "./speech";

export const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
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

export function buildTtsRequest(input: {
  text: string;
  voice: string;
  style?: string;
  stream: boolean;
}): Record<string, unknown> {
  return {
    model: TTS_MODEL,
    input: input.text,
    voice: input.voice,
    response_format: TTS_RESPONSE_FORMAT,
    ...(input.style ? { instructions: input.style } : {}),
    ...(input.stream ? { stream_format: "sse" } : {}),
  };
}

export function openAiTextToSpeech(defaultVoice: string): TextToSpeech {
  return {
    id: `openai:${TTS_MODEL}:${defaultVoice}`,
    voice: defaultVoice,
    isAvailable: hasOpenAiKey,
    async synthesize(input): Promise<Speech> {
      const response = await postSpeech(input, defaultVoice, false);
      return {
        audio: new Uint8Array(await response.arrayBuffer()),
        mimeType: TTS_MIME_TYPE,
        source: `openai:${TTS_MODEL}`,
      };
    },
    async *synthesizeStream(input): AsyncIterable<Uint8Array> {
      const response = await postSpeech(input, defaultVoice, true);
      for await (const chunk of decodeSpeechSse(response)) yield chunk;
    },
  };
}

async function postSpeech(
  input: { text: string; style?: string; voice?: string },
  defaultVoice: string,
  stream: boolean,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(SPEECH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(
        buildTtsRequest({
          text: input.text,
          voice: input.voice ?? defaultVoice,
          style: input.style,
          stream,
        }),
      ),
    });
  } catch (error) {
    throw new VoiceUnavailableError(`Network error calling ${TTS_MODEL}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new VoiceUnavailableError(
      `${TTS_MODEL} call failed: ${response.status} ${response.statusText} ${body}`.trim(),
    );
  }
  return response;
}

export async function* decodeSpeechSse(response: Response): AsyncIterable<Uint8Array> {
  if (!response.body) throw new VoiceUnavailableError("TTS stream carried no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline).trim();
      if (speechStreamDone(line)) {
        await reader.cancel();
        return;
      }
      const chunk = speechDeltaBytes(line);
      if (chunk) yield chunk;
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  }
  const finalLine = buffered.trim();
  if (speechStreamDone(finalLine)) return;
  const finalChunk = speechDeltaBytes(finalLine);
  if (finalChunk) yield finalChunk;
}

export function speechStreamDone(line: string): boolean {
  if (!line.startsWith("data:")) return false;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return true;
  try {
    return (JSON.parse(payload) as { type?: unknown }).type === "speech.audio.done";
  } catch {
    return false;
  }
}

export function speechDeltaBytes(line: string): Uint8Array | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const event = JSON.parse(payload) as { type?: unknown; audio?: unknown };
    if (event.type !== "speech.audio.delta" || typeof event.audio !== "string") return null;
    return Uint8Array.from(Buffer.from(event.audio, "base64"));
  } catch {
    return null;
  }
}

export const openAiTutorSpeechToText: SpeechToText = {
  id: `openai:${TUTOR_STT_MODEL}`,
  isAvailable: hasOpenAiKey,
  async transcribe({ audio, mimeType, language }): Promise<Transcript> {
    const form = new FormData();
    form.append("model", TUTOR_STT_MODEL);
    form.append("response_format", "json");
    if (language) form.append("language", language);
    form.append("file", new Blob([audio as BlobPart], { type: mimeType }), `turn.${extensionFor(mimeType)}`);
    let response: Response;
    try {
      response = await fetch(TRANSCRIPTION_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}` },
        body: form,
      });
    } catch (error) {
      throw new VoiceUnavailableError(
        `Network error calling ${TUTOR_STT_MODEL}: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new VoiceUnavailableError(
        `${TUTOR_STT_MODEL} call failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }
    const data = (await response.json()) as {
      text?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    return {
      text: typeof data.text === "string" ? data.text.trim() : "",
      source: `openai:${TUTOR_STT_MODEL}`,
      usage: {
        inputTokens: Number(data.usage?.input_tokens) || 0,
        outputTokens: Number(data.usage?.output_tokens) || 0,
      },
    };
  },
};

export function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  return subtype === "mpeg" ? "mp3" : subtype;
}
