// The tutor's voice, played in order (E-43). Client-safe, framework-free and
// dependency-injected, so the ordering and barge-in rules are unit-testable without a
// browser — the React page only wires the real `fetch` and the real `Audio` in.
//
// THE RULE THAT MATTERS: synthesis is PIPELINED, playback is SERIAL. The moment a
// sentence of the reply is ready its synthesis request goes out, even while the
// previous sentence is still being spoken — so only the FIRST chunk's latency is ever
// on the critical path, and a three-sentence reply does not cost three round-trips
// end to end. But the clips are played strictly in the order they were enqueued,
// because a tutor whose sentences arrive out of order is worse than a slow one.
//
// BARGE-IN. `stop()` cancels everything: in-flight requests, queued clips and current
// playback. Server VAD reports the learner starting to speak
// (`input_audio_buffer.speech_started`), and talking over Erika must stop her at once
// — `interrupt_response` already cancels the model's side, and this cancels ours.

/** What the queue needs from its environment. Injected so tests need no browser. */
export interface SpeechQueueDeps {
  /** Fetch the audio for one chunk of reply text. Rejects on refusal or failure. */
  fetchAudio: (text: string, seq: number, signal: AbortSignal) => Promise<Blob>;
  /** Play one clip to completion. Resolves when it finishes or is stopped. */
  play: (clip: Blob, signal: AbortSignal) => Promise<void>;
  /** Called when the queue starts and stops making sound — drives the dots field and
   *  the "Listening / Speaking" line. */
  onSpeakingChange?: (speaking: boolean) => void;
  /** Called when a chunk could not be spoken, with a message fit for a person. */
  onError?: (message: string) => void;
}

export class SpeechQueue {
  private seq = 0;
  private pending: Promise<Blob>[] = [];
  private draining = false;
  private controller: AbortController | null = null;

  constructor(private readonly deps: SpeechQueueDeps) {}

  /** Queue one chunk of reply text. Returns immediately; synthesis starts now. */
  speak(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!this.controller) this.controller = new AbortController();
    const signal = this.controller.signal;
    const seq = this.seq++;
    // Started EAGERLY — this is the pipelining. `catch` is attached here so an early
    // rejection never becomes an unhandled rejection while the clip waits its turn.
    const request = this.deps.fetchAudio(trimmed, seq, signal);
    request.catch(() => undefined);
    this.pending.push(request);
    void this.drain();
  }

  /** Stop everything: in-flight synthesis, queued clips and current playback. */
  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.pending = [];
    this.deps.onSpeakingChange?.(false);
  }

  /** Whether anything is queued or playing. */
  get busy(): boolean {
    return this.draining || this.pending.length > 0;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.deps.onSpeakingChange?.(true);
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift() as Promise<Blob>;
        const signal = this.controller?.signal;
        if (!signal || signal.aborted) break;
        let clip: Blob;
        try {
          clip = await next;
        } catch (err) {
          if (!signal.aborted) this.deps.onError?.(messageOf(err));
          continue;
        }
        if (signal.aborted) break;
        try {
          await this.deps.play(clip, signal);
        } catch {
          // A failed playback is not worth a message of its own; the next clip runs.
        }
      }
    } finally {
      this.draining = false;
      this.deps.onSpeakingChange?.(false);
    }
  }
}

function messageOf(err: unknown): string {
  const message = (err as Error)?.message;
  return typeof message === "string" && message.length > 0 ? message : "Erika could not speak that line.";
}
