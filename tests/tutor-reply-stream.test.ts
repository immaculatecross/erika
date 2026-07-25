import { describe, expect, it, vi } from "vitest";
import { MIN_SPEAKABLE_CHARS, ReplyChunker, nextSpeakableChunk } from "@/lib/tutor/reply-stream";
import { SpeechQueue } from "@/lib/tutor/speech-queue";

// The two pure pieces of the speaking leg (E-43, Amendment 1 criterion 11).
//
// Streaming TTS is mandatory, not an optimization: a blocking turn measured 4.63 s
// against a 2–4 s band (spike-5 §4), and under transport (A) this is the ONLY place
// per-turn latency can still be won (Amendment 4 §20). The rule that decides WHEN to
// start speaking, and the queue that keeps clips in order while their synthesis runs
// in parallel, are both testable without a browser — so they are tested here rather
// than read.

describe("nextSpeakableChunk — when a sentence is ready to speak", () => {
  it("waits for a sentence boundary rather than speaking a fragment", () => {
    expect(nextSpeakableChunk("Ciao, come stai oggi? Volevo", 0, false)).toBe("Ciao, come stai oggi?");
    expect(nextSpeakableChunk("Ciao, come stai oggi", 0, false)).toBeNull();
  });

  it("refuses a boundary that would make a chunk too short to be worth a request", () => {
    // "Sì." is a whole sentence and a terrible request: the round-trip costs more than
    // it saves and the delivery turns choppy. It rides on the turn's final flush.
    expect(nextSpeakableChunk("Sì. ", 0, false)).toBeNull();
    expect("Sì.".length).toBeLessThan(MIN_SPEAKABLE_CHARS);
    expect(nextSpeakableChunk("Sì. ", 0, true)).toBe("Sì.");
  });

  it("takes the FIRST usable boundary, not the last — the whole point is starting early", () => {
    const text = "Hai detto una cosa giusta. Però c'è un piccolo errore. Riprova pure.";
    expect(nextSpeakableChunk(text, 0, false)).toBe("Hai detto una cosa giusta.");
  });

  it("keeps a closing quote with its sentence", () => {
    expect(nextSpeakableChunk('Hai detto "la ragazzo." Si dice il ragazzo.', 0, false)).toBe(
      'Hai detto "la ragazzo."',
    );
  });

  it("does not break inside a decimal or an ellipsis", () => {
    expect(nextSpeakableChunk("Il numero corretto sarebbe 3.5 gradi circa", 0, false)).toBeNull();
    expect(nextSpeakableChunk("Aspetta un attimo...ancora non ho finito", 0, false)).toBeNull();
  });

  it("breaks on the other Italian sentence enders too", () => {
    for (const ender of ["!", "?", "…", ";", ":"]) {
      expect(nextSpeakableChunk(`Questa è una frase abbastanza lunga${ender} e poi altro`, 0, false)).toBe(
        `Questa è una frase abbastanza lunga${ender}`,
      );
    }
  });

  it("flushes everything left at the end of a turn, however short", () => {
    expect(nextSpeakableChunk("Perfetto", 0, true)).toBe("Perfetto");
    expect(nextSpeakableChunk("   ", 0, true)).toBeNull();
  });
});

describe("ReplyChunker — a turn's deltas become ordered chunks", () => {
  it("emits each sentence once, in order, and nothing twice", () => {
    const c = new ReplyChunker();
    const out: string[] = [];
    for (const delta of ["Ciao, come ", "stai oggi? ", "Raccontami la tua ", "giornata di ieri. ", "Va bene"]) {
      out.push(...c.push(delta));
    }
    expect(out).toEqual(["Ciao, come stai oggi?", "Raccontami la tua giornata di ieri."]);
    expect(c.flush()).toBe("Va bene");
    expect(c.flush()).toBeNull();
  });

  it("emits several sentences that arrive in one delta", () => {
    const c = new ReplyChunker();
    expect(c.push("Bene così, davvero. Adesso prova di nuovo, con calma. ")).toEqual([
      "Bene così, davvero.",
      "Adesso prova di nuovo, con calma.",
    ]);
  });

  it("loses no text: every character of the turn is spoken exactly once", () => {
    // The property that actually matters. Reconstructing the reply from the chunks
    // must give back the whole reply, so nothing is silently dropped or repeated.
    const reply =
      "Attenzione: hai detto ho andato. Si dice sono andato, con essere. Comunque il resto era ottimo! Continua pure così.";
    const c = new ReplyChunker();
    const spoken: string[] = [];
    for (let i = 0; i < reply.length; i += 7) spoken.push(...c.push(reply.slice(i, i + 7)));
    const rest = c.flush();
    if (rest) spoken.push(rest);
    expect(spoken.join(" ").replace(/\s+/g, " ")).toBe(reply.replace(/\s+/g, " "));
  });

  it("reset() starts a clean turn", () => {
    const c = new ReplyChunker();
    c.push("Una frase piuttosto lunga da dire. ");
    c.reset();
    expect(c.full()).toBe("");
    expect(c.flush()).toBeNull();
  });
});

describe("SpeechQueue — pipelined synthesis, serial playback, instant barge-in", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("starts synthesizing chunk 2 while chunk 1 is still playing", async () => {
    // This is the latency win: only the FIRST chunk's round-trip is on the critical
    // path. If synthesis were serialized behind playback, a three-sentence reply would
    // cost three round-trips end to end.
    const started: number[] = [];
    const gate = deferred<void>();
    const queue = new SpeechQueue({
      fetchAudio: async (_t, seq) => {
        started.push(seq);
        return new Blob([new Uint8Array(4)]);
      },
      play: () => gate.promise,
    });
    queue.speak("Prima frase, abbastanza lunga.");
    queue.speak("Seconda frase, altrettanto lunga.");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1]); // both requests are out while nothing has finished
    gate.resolve();
  });

  it("plays clips strictly in order", async () => {
    const played: string[] = [];
    const queue = new SpeechQueue({
      fetchAudio: async (text, seq) => {
        // The second chunk's synthesis finishes FIRST; playback order must not follow.
        await new Promise((r) => setTimeout(r, seq === 0 ? 30 : 0));
        return new Blob([text]);
      },
      play: async (clip) => {
        played.push(await clip.text());
      },
    });
    queue.speak("Prima frase, abbastanza lunga.");
    queue.speak("Seconda frase, altrettanto lunga.");
    await vi.waitFor(() => expect(played).toHaveLength(2));
    expect(played).toEqual(["Prima frase, abbastanza lunga.", "Seconda frase, altrettanto lunga."]);
  });

  it("stop() aborts in-flight synthesis and drops everything queued (barge-in)", async () => {
    const aborted: boolean[] = [];
    const played: string[] = [];
    const queue = new SpeechQueue({
      fetchAudio: (text, _seq, signal) =>
        new Promise<Blob>((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted.push(true);
            reject(new Error("aborted"));
          });
          setTimeout(() => resolve(new Blob([text])), 50);
        }),
      play: async (clip) => {
        played.push(await clip.text());
      },
    });
    queue.speak("Una frase che non verrà mai detta.");
    queue.speak("E nemmeno questa, mai e poi mai.");
    queue.stop();
    await new Promise((r) => setTimeout(r, 80));
    expect(aborted.length).toBeGreaterThan(0);
    expect(played).toEqual([]);
  });

  it("surfaces a refusal as a message a person can read, and carries on", async () => {
    const errors: string[] = [];
    const played: string[] = [];
    const queue = new SpeechQueue({
      fetchAudio: async (text, seq) => {
        if (seq === 0) throw new Error("The monthly budget cannot cover more of this conversation.");
        return new Blob([text]);
      },
      play: async (clip) => {
        played.push(await clip.text());
      },
      onError: (m) => errors.push(m),
    });
    queue.speak("Prima frase, abbastanza lunga.");
    queue.speak("Seconda frase, altrettanto lunga.");
    await vi.waitFor(() => expect(played).toHaveLength(1));
    expect(errors).toEqual(["The monthly budget cannot cover more of this conversation."]);
  });

  it("reports when it is making sound, so the dots and the turn line stay honest", async () => {
    const states: boolean[] = [];
    const queue = new SpeechQueue({
      fetchAudio: async (text) => new Blob([text]),
      play: async () => {},
      onSpeakingChange: (s) => states.push(s),
    });
    queue.speak("Una frase sufficientemente lunga.");
    await vi.waitFor(() => expect(states).toContain(false));
    expect(states[0]).toBe(true);
    expect(states[states.length - 1]).toBe(false);
  });

  it("ignores an empty chunk rather than paying for silence", async () => {
    const fetchAudio = vi.fn(async () => new Blob(["x"]));
    const queue = new SpeechQueue({ fetchAudio, play: async () => {} });
    queue.speak("   ");
    expect(fetchAudio).not.toHaveBeenCalled();
  });
});
