export interface Transcript {
  text: string;
  source: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface SpeechToText {
  readonly id: string;
  isAvailable(): boolean;
  transcribe(input: {
    audio: Uint8Array;
    mimeType: string;
    language?: string;
  }): Promise<Transcript>;
}

export interface Speech {
  audio: Uint8Array;
  mimeType: string;
  source: string;
}

export interface TextToSpeech {
  readonly id: string;
  readonly voice: string;
  isAvailable(): boolean;
  synthesize(input: {
    text: string;
    style?: string;
    language?: string;
    voice?: string;
  }): Promise<Speech>;
  synthesizeStream?(
    input: Parameters<TextToSpeech["synthesize"]>[0],
  ): AsyncIterable<Uint8Array>;
}

export class VoiceUnavailableError extends Error {}
