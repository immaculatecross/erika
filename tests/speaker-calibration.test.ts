import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spectralEmbedder } from "@/lib/speaker/spectral-embedder";
import { cosineSimilarity, centroid } from "@/lib/speaker/embedder";
import { SPEAKER_USER_THRESHOLD } from "@/lib/speaker/attribution";

// E-36 criterion 3, under D-13/D-22: the recall-first threshold τ is calibrated
// against a committed TWO-VOICE labelled fixture (tests/fixtures/labelled-speaker),
// and the fixture is built to be genuinely FALSIFYING — the two synthetic voices
// carry realistic within-speaker spread and between-speaker OVERLAP (see
// make-labelled-speaker.sh), not a trivially separable gap. We prove three things:
//
//   1. the shipped τ (SPEAKER_USER_THRESHOLD) reaches user-recall ≥ 0.99 (never drops
//      the user, D-22) while still EXCLUDING a real fraction of the other speaker;
//   2. a NAIVE baseline fails — "mark everything the user" excludes nobody, and a
//      naive midpoint-of-means τ drops user windows (recall < 0.99);
//   3. the fixture is not trivially separable — the classes OVERLAP, so a lazy τ
//      cannot both keep every user window and exclude every other window.
//
// CALIBRATION PATH (stated plainly, D-19): the in-sandbox EMBEDDING genuinely runs
// (`spectral-logmel-v1` — ffmpeg + a log-mel filterbank, exercised end to end here),
// but the fixture VOICES are SYNTHETIC (procedurally generated ffmpeg formant
// voices, not recorded audio) — so this calibrates the METHOD, not a production
// operating point. The production sherpa-onnx model lives in a different embedding
// space and its live τ re-calibration against REAL recorded voices is OPERATOR-GATED
// (the sandbox has no egress/model).

const FIX = path.join(__dirname, "fixtures");
const FILE = path.join(FIX, "labelled-speaker.flac");
const LABELS = JSON.parse(fs.readFileSync(path.join(FIX, "labelled-speaker.json"), "utf8")) as {
  totalMs: number;
  sampleRateHz: number;
  windows: { startMs: number; endMs: number; speaker: "user" | "other"; enroll: boolean }[];
};

const SLOW = 120_000;

/** Embed every labelled window and score it against the enrolled reference. */
async function scoreWindows() {
  const embedded = [];
  for (const w of LABELS.windows) {
    embedded.push({ ...w, v: await spectralEmbedder.embed(FILE, w.startMs, w.endMs) });
  }
  const reference = centroid(embedded.filter((e) => e.enroll).map((e) => e.v));
  return embedded.map((e) => ({ ...e, sim: cosineSimilarity(e.v, reference) }));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const recallAt = (userSims: number[], tau: number) => userSims.filter((s) => s >= tau).length / userSims.length;
const excludeAt = (otherSims: number[], tau: number) => otherSims.filter((s) => s < tau).length / otherSims.length;

describe("E-36 speaker attribution — D-13 calibration on a two-voice fixture", () => {
  it("the shipped recall-first τ keeps every user window while excluding the other speaker", async () => {
    const scored = await scoreWindows();
    // Recall is measured on HELD-OUT user windows (enroll=false) — the enrollment
    // windows built the centroid and would inflate it trivially.
    const heldUser = scored.filter((s) => s.speaker === "user" && !s.enroll).map((s) => s.sim);
    const other = scored.filter((s) => s.speaker === "other").map((s) => s.sim);
    expect(heldUser.length).toBeGreaterThanOrEqual(4);
    expect(other.length).toBeGreaterThanOrEqual(6);

    // (1) recall-first: NO user window is dropped by the shipped τ (≥ 0.99).
    expect(recallAt(heldUser, SPEAKER_USER_THRESHOLD)).toBeGreaterThanOrEqual(0.99);
    // …and it genuinely EXCLUDES the other speaker at a stated, non-trivial rate.
    const exclusion = excludeAt(other, SPEAKER_USER_THRESHOLD);
    expect(exclusion).toBeGreaterThan(0.4);
    // The trade D-22 accepts is admitted, not hidden: some other windows survive as
    // false-includes (the fixture overlaps on purpose), so exclusion is < 1.
    expect(exclusion).toBeLessThan(1);
  }, SLOW);

  it("falsifies naive baselines: accept-all excludes nobody; midpoint-of-means drops the user", async () => {
    const scored = await scoreWindows();
    const heldUser = scored.filter((s) => s.speaker === "user" && !s.enroll).map((s) => s.sim);
    const other = scored.filter((s) => s.speaker === "other").map((s) => s.sim);

    // Baseline A — "mark everything the user" (τ ≤ every score): recall is perfect
    // but it excludes NO other-speaker window, so it never protects the knowledge
    // model from a bystander. It fails the exclusion the calibrated τ achieves.
    const acceptAllExclusion = excludeAt(other, 0);
    expect(acceptAllExclusion).toBe(0);
    expect(acceptAllExclusion).toBeLessThan(excludeAt(other, SPEAKER_USER_THRESHOLD));

    // Baseline B — a naive midpoint between the two class means. Because the classes
    // OVERLAP, this sits ABOVE the lowest user window and therefore DROPS it: recall
    // falls below 0.99, violating recall-first. This is exactly the failure a
    // synthetic-but-separable fixture could not exhibit (D-13).
    const naiveTau = (mean(heldUser) + mean(other)) / 2;
    expect(recallAt(heldUser, naiveTau)).toBeLessThan(0.99);
  }, SLOW);

  it("the fixture is not trivially separable — the classes overlap", async () => {
    const scored = await scoreWindows();
    const userFloor = Math.min(...scored.filter((s) => s.speaker === "user" && !s.enroll).map((s) => s.sim));
    const otherMax = Math.max(...scored.filter((s) => s.speaker === "other").map((s) => s.sim));
    // At least one other-speaker window scores ABOVE the lowest user window: no single
    // τ both keeps every user window and excludes every other window. A tone-vs-tone
    // fixture would have otherMax ≪ userFloor and prove nothing.
    expect(otherMax).toBeGreaterThan(userFloor);
  }, SLOW);

  it("the embedder is deterministic — the calibration is reproducible", async () => {
    const a = await spectralEmbedder.embed(FILE, 0, 2200);
    const b = await spectralEmbedder.embed(FILE, 0, 2200);
    expect(Array.from(a)).toEqual(Array.from(b));
    // A unit vector (L2-normalized), so cosine against the reference is well-scaled.
    const norm = Math.sqrt(Array.from(a).reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  }, SLOW);
});
