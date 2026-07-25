// The voice vendor seam (E-43). Two interfaces, injected exactly the way
// `AudioModelClient` (lib/analysis/audio-model.ts) and `SpeakerEmbedder`
// (lib/speaker/embedder.ts) already are: the caller chooses the implementation and
// passes it in, so no module-level singleton decides for anyone and every test runs
// against a plain fake with no network.
//
// The boundary is the PARSED result — bytes, text, a duration — never a vendor
// response object. Nothing OpenAI-shaped escapes this file's types, so dropping in
// Cartesia (the operator's named candidate) touches these two impl files and nothing
// in the loop. Concretely, and each of these is a lesson from a measured contract:
//
//   1. `voice` is an OPAQUE provider-scoped string, never an enum of OpenAI voice
//      names (lib/voice/voices.ts owns the OpenAI mapping, alone).
//   2. `style` is an OPTIONAL hint a vendor MAY IGNORE. Cartesia exposes structured
//      speed/emotion controls rather than a free-text instruction, so a hard
//      requirement here would leak an OpenAI concept into the loop. It is also empty
//      by DEFAULT — see the note on `synthesize`.
//   3. `segments` is OPTIONAL. Timestamp support varies WITHIN OpenAI's own lineup:
//      `verbose_json` on `gpt-4o-transcribe` is a hard **400**, not a graceful
//      downgrade (spike-5 §3, measured). No caller may require it.
//   4. `synthesizeStream` is OPTIONAL so a non-streaming vendor stays conformant —
//      but it exists because time-to-first-audio is the whole latency budget
//      (spike-5 §4: 4.63 s blocking vs 0.844 s to first byte streaming).
//
// ── WHERE EACH LEG MAY BE USED (D-3, D-28 — read before wiring either one) ────
//
// **TextToSpeech is the tutor's whole speaking leg.** That half was always the
// broken one ("it listens very well, but it does not speak super well"), and D-28
// settles it: `alloy` / `nova`, plain synthesis.
//
// **SpeechToText MUST NEVER transcribe free speech for error detection.** D-3 forbids
// it and spike-6 §2.2 measured why: `whisper-1` silently repaired this project's own
// planted errors — `familia` → `famiglia`, `note` → `notte` — handing back clean
// sentences before any model could see the mistake. The tutor therefore listens with
// an audio-native model (D-28 transport A) and never through this interface. STT
// survives here for exactly two uses, both of which are D-21's existing allowance for
// a SCRIPTED, KNOWN-ANSWER response: a pronunciation/drill answer whose target text is
// already known, and E-46's spoken level check. If you are reaching for `SpeechToText`
// and you do not already know what the learner was supposed to say, stop.

/** One transcription of a learner's utterance. */
export interface Transcript {
  /** Recognized text, trimmed. Empty when nothing intelligible was said — a silent
   *  turn is a normal outcome, never an error. */
  text: string;
  /** Provider+model, for provenance and cost attribution, e.g. "openai:gpt-4o-transcribe". */
  source: string;
  /** Segment timings when the provider returns them. OPTIONAL by contract (see 3). */
  segments?: { startMs: number; endMs: number; text: string }[];
}

export interface SpeechToText {
  readonly id: string;
  /** Whether this implementation can run here (e.g. a key is present) — mirrors
   *  `SpeakerEmbedder.isAvailable`, so a caller can degrade truthfully instead of
   *  throwing at the user. */
  isAvailable(): boolean;
  transcribe(input: {
    /** Raw encoded bytes as captured (webm/opus from MediaRecorder, wav, mp3…). */
    audio: Uint8Array;
    /** Container mime type, so the vendor can label its upload correctly. */
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
  /** Duration when known — the honest basis for TTS cost, since `/v1/audio/speech`
   *  returns no `usage` object (spike-5 §5.3). */
  durationMs?: number;
}

export interface TextToSpeech {
  readonly id: string;
  isAvailable(): boolean;
  /** The provider-scoped voice this implementation speaks with when none is named. */
  readonly voice: string;
  /**
   * Synthesize `text`.
   *
   * ⚠️ `style` IS EMPTY BY DEFAULT AND THAT IS A RULING, NOT AN OVERSIGHT. Both
   * voices the operator picked were the PLAIN samples; all three instructed
   * renditions were passed over. Measurably, instructing `alloy` made it speak 9%
   * faster (spike-5 §2.2) — a change, not obviously an improvement. So the steering
   * channel is opt-in, and D-23's register dial governs WHAT the tutor says (word
   * choice, formality) through the language model, which is where register has always
   * belonged; it must not be silently re-implemented as TTS prosody.
   *
   * When a caller does set `style`, the OpenAI implementation passes it through as
   * `instructions` and it reaches the audio; a vendor with only structured controls
   * may ignore it entirely.
   */
  synthesize(input: {
    text: string;
    style?: string;
    language?: string;
    voice?: string;
  }): Promise<Speech>;
  /** Streaming synthesis. Absent ⇒ the caller falls back to `synthesize`. */
  synthesizeStream?(input: Parameters<TextToSpeech["synthesize"]>[0]): AsyncIterable<Uint8Array>;
}

/** Thrown when a voice vendor is unreachable, unauthorized or has no key. */
export class VoiceUnavailableError extends Error {}
