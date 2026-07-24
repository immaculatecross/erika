import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cosineSimilarity, centroid, type SpeakerEmbedder } from "@/lib/speaker/embedder";
import { windowsFor, attributeSegment, WINDOW_MS } from "@/lib/speaker/attribution";
import { speakerFilterEnabled } from "@/lib/speaker";

// E-36 unit behaviour: the pure window math, the recall-first max-over-windows
// verdict against a MOCK embedder (no ffmpeg, no model), and the D-22 privacy
// invariant — no network anywhere on the attribution path.

const USER = Float32Array.from([1, 0, 0]);
const OTHER = Float32Array.from([0, 1, 0]);

/** A mock embedder that returns a canned vector per keyword in the window bounds,
 *  so a "segment" can be made to contain a user window, an other window, or both. */
function mockEmbedder(planFor: (startMs: number) => Float32Array): SpeakerEmbedder {
  return {
    id: "mock",
    isAvailable: () => true,
    embed: async (_p, startMs) => planFor(startMs),
  };
}

describe("windowsFor", () => {
  it("covers a long span with overlapping ~4 s windows and a tail window", () => {
    const ws = windowsFor(0, 10_000);
    expect(ws[0]).toEqual({ startMs: 0, endMs: WINDOW_MS });
    expect(ws.every((w) => w.endMs - w.startMs <= WINDOW_MS)).toBe(true);
    expect(ws[ws.length - 1].endMs).toBe(10_000); // the tail is covered
  });

  it("returns a single window for a span shorter than one window", () => {
    expect(windowsFor(0, 2500)).toEqual([{ startMs: 0, endMs: 2500 }]);
  });

  it("returns nothing for a non-positive span", () => {
    expect(windowsFor(500, 500)).toEqual([]);
  });
});

describe("attributeSegment — recall-first max over windows", () => {
  const ref = { enrollmentId: "e", vector: USER, windowCount: 3 };

  it("credits the user when ANY window matches, even amid other-speaker windows", async () => {
    // A long segment: first windows are the other speaker, a later one is the user.
    const embedder = mockEmbedder((startMs) => (startMs >= 6000 ? USER : OTHER));
    const v = await attributeSegment(embedder, "seg.wav", 10_000, ref, 0.5);
    expect(v.isUser).toBe(1); // recall-first: the user spoke in it ⇒ never dropped
    expect(v.speakerScore).toBeCloseTo(1, 5);
  });

  it("marks a segment non-user when no window matches", async () => {
    const embedder = mockEmbedder(() => OTHER);
    const v = await attributeSegment(embedder, "seg.wav", 10_000, ref, 0.5);
    expect(v.isUser).toBe(0);
    expect(v.speakerScore).toBeCloseTo(0, 5);
  });

  it("is unattributed (null) when every window fails to embed", async () => {
    const embedder: SpeakerEmbedder = {
      id: "throwing",
      isAvailable: () => true,
      embed: async () => {
        throw new Error("decode failed");
      },
    };
    const v = await attributeSegment(embedder, "seg.wav", 10_000, ref, 0.5);
    expect(v).toEqual({ speakerScore: null, isUser: null });
  });
});

describe("cosine + centroid", () => {
  it("cosine is 1 for identical direction, 0 for orthogonal, 0 for a zero vector", () => {
    expect(cosineSimilarity(USER, USER)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(USER, OTHER)).toBeCloseTo(0, 6);
    expect(cosineSimilarity(USER, Float32Array.from([0, 0, 0]))).toBe(0);
  });

  it("centroid averages then unit-normalizes", () => {
    const c = centroid([USER, OTHER]);
    expect(Math.hypot(...Array.from(c))).toBeCloseTo(1, 6);
    expect(c[0]).toBeCloseTo(c[1], 6); // symmetric between the two inputs
  });
});

describe("kill-switch", () => {
  it("ERIKA_SPEAKER_FILTER=off disables the filter; anything else leaves it on", () => {
    expect(speakerFilterEnabled("off")).toBe(false);
    expect(speakerFilterEnabled("OFF")).toBe(false);
    expect(speakerFilterEnabled(undefined)).toBe(true);
    expect(speakerFilterEnabled("on")).toBe(true);
  });
});

describe("privacy invariant (D-22) — no network on the attribution path", () => {
  it("no lib/speaker module makes a network call", () => {
    const dir = path.join(process.cwd(), "lib", "speaker");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      // No fetch/http client, no upload/host of audio or embeddings — all acoustic
      // processing is on-device (enrollment + session audio never leave the machine).
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/https?:\/\//);
      expect(src).not.toMatch(/require\(['"]node:(https?|net|dgram)['"]\)|from ['"]node:(https?|net|dgram)['"]/);
    }
  });
});
