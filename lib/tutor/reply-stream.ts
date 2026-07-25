// Turning the tutor's streaming TEXT reply into speakable chunks (E-43). Pure and
// client-safe — no I/O, no DOM — so the rule that decides when to start speaking is
// unit-testable on its own.
//
// WHY THIS EXISTS AT ALL. Under D-28 the reply arrives as text deltas on the Realtime
// data channel and is spoken through TTS, so per-turn latency is the sum of "wait for
// text" + "wait for audio". spike-5 §4 measured a blocking turn at 4.63 s against a
// 2–4 s acceptable band and made streaming TTS mandatory (Amendment 1 criterion 11,
// still binding after Amendment 4 — it is now the ONLY place latency can be won).
//
// spike-6 §5.2 measured transport (A) at p50 **1.194 s to first text** and **1.588 s
// to full text**. Waiting for the full reply and then synthesizing puts first audio at
// ≈2.43 s. Starting synthesis on the first COMPLETE SENTENCE starts the TTS leg ~0.4 s
// earlier, which is the whole difference spike-5 §4 says is available ("stream the LLM
// too and begin TTS on the first sentence rather than the full reply").
//
// The chunk boundary is a real constraint, not a nicety: synthesizing a fragment makes
// the tutor sound clipped, and synthesizing "Sì." on its own wastes a whole request
// round-trip for a syllable. So a chunk ends at a sentence boundary and is never
// shorter than MIN_SPEAKABLE_CHARS unless it is the last of the turn.

/** Sentence-ending punctuation a chunk may break on. */
const TERMINATORS = new Set([".", "!", "?", "…", ";", ":", "\n"]);

/** Characters that legitimately trail a terminator and belong to the same sentence. */
const TRAILERS = new Set(['"', "'", "»", "”", "’", ")", "]", "]"]);

/**
 * Shortest chunk worth a request of its own. Below this the round-trip costs more
 * than it saves and one-word clips make the delivery choppy, so a short sentence
 * waits and rides out with the next one (or with the turn's final flush).
 *
 * Sized to admit a real opening line — "Ciao, come stai oggi?" is 21 characters, and a
 * threshold that rejected it would merge the tutor's first sentence into its second
 * and give away most of the latency this whole module exists to win — while still
 * refusing a bare "Sì."
 */
export const MIN_SPEAKABLE_CHARS = 16;

/**
 * The next chunk of `text` that is ready to speak, given how much has already been
 * handed off, or null when nothing is.
 *
 * `final` means the model has finished this turn: everything left is flushed, however
 * short, because there is no more text coming to complete it.
 */
export function nextSpeakableChunk(text: string, consumed: number, final: boolean): string | null {
  const remainder = text.slice(Math.max(0, consumed));
  if (final) {
    const rest = remainder.trim();
    return rest.length > 0 ? rest : null;
  }
  for (let i = 0; i < remainder.length; i += 1) {
    if (!TERMINATORS.has(remainder[i])) continue;
    // A period between digits is a decimal, not a sentence end.
    if (remainder[i] === "." && /\d/.test(remainder[i - 1] ?? "") && /\d/.test(remainder[i + 1] ?? "")) continue;
    let end = i + 1;
    while (end < remainder.length && TRAILERS.has(remainder[end])) end += 1;
    // The boundary is real only once the next character is whitespace or absent;
    // otherwise we are mid-token (an ellipsis, an abbreviation, a URL).
    const after = remainder[end];
    if (after !== undefined && !/\s/.test(after)) continue;
    const candidate = remainder.slice(0, end).trim();
    if (candidate.length >= MIN_SPEAKABLE_CHARS) return candidate;
  }
  return null;
}

/**
 * Accumulates a turn's text deltas and yields speakable chunks in order. One instance
 * per learner turn; `reset()` starts the next one.
 *
 * Deliberately a tiny class rather than a hook: the sequencing rule is the part that
 * can be wrong, and it should be testable without rendering anything.
 */
export class ReplyChunker {
  private text = "";
  private consumed = 0;

  /** Add a delta; return every chunk that became speakable because of it. */
  push(delta: string): string[] {
    this.text += delta;
    const out: string[] = [];
    for (;;) {
      const chunk = nextSpeakableChunk(this.text, this.consumed, false);
      if (chunk === null) break;
      // Advance past the chunk in the ORIGINAL text, trailing whitespace included, so
      // the next scan starts exactly where this chunk ended.
      const at = this.text.indexOf(chunk, this.consumed);
      this.consumed = at === -1 ? this.text.length : at + chunk.length;
      out.push(chunk);
    }
    return out;
  }

  /** Flush whatever remains at the end of the turn, however short. */
  flush(): string | null {
    const chunk = nextSpeakableChunk(this.text, this.consumed, true);
    this.consumed = this.text.length;
    return chunk;
  }

  /** The whole turn's text so far. */
  full(): string {
    return this.text;
  }

  reset(): void {
    this.text = "";
    this.consumed = 0;
  }
}
