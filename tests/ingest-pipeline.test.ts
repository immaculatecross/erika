import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeDuration, probeField } from "@/lib/ingest/ffmpeg";
import { processJob } from "@/lib/ingest/pipeline";
import { normalizedPath, renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { getSession } from "@/lib/sessions";
import { listSegments } from "@/lib/segments";
import { cleanup, workspace, type Part, type Workspace } from "./fixtures";

// End-to-end pipeline behavior against real, synthesized ffmpeg fixtures. Heavy
// tests get explicit timeouts; the multi-minute fixture is the slow one.

const SLOW = 120_000;
let ws: Workspace;
afterEach(() => {
  if (ws) cleanup(ws);
});

const TWO_THREE_FOUR: Part[] = [
  { kind: "tone", seconds: 2 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 4 },
];

function mtime(p: string): number {
  return fs.statSync(p).mtimeMs;
}

describe("ingest pipeline", () => {
  it("criterion 1 — normalizes the source to 16 kHz mono", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    await processJob(ws.db, jobId);
    const norm = normalizedPath(sessionId);
    expect(fs.existsSync(norm)).toBe(true);
    expect(Number(await probeField(norm, "stream=sample_rate"))).toBe(16000);
    expect(Number(await probeField(norm, "stream=channels"))).toBe(1);
  }, SLOW);

  it("criterion 2 — extracts the two speech intervals, discards the silence", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    await processJob(ws.db, jobId);
    const segs = listSegments(ws.db, sessionId);
    expect(segs).toHaveLength(2);
    expect(segs[0].startMs).toBeGreaterThanOrEqual(0);
    expect(segs[0].endMs).toBeCloseTo(2000, -3); // ~2s ± tolerance
    expect(segs[1].startMs).toBeCloseTo(5000, -3);
    expect(segs[1].endMs).toBeCloseTo(9000, -3);
  }, SLOW);

  it("criterion 3 — drops the sub-2s interval, keeps the 5s one", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed([
      { kind: "tone", seconds: 1 },
      { kind: "silence", seconds: 3 },
      { kind: "tone", seconds: 5 },
    ]);
    await processJob(ws.db, jobId);
    const segs = listSegments(ws.db, sessionId);
    expect(segs).toHaveLength(1);
    expect(segs[0].durationMs).toBeCloseTo(5000, -3); // the 5s tone, not the 1s
  }, SLOW);

  it("criterion 4 — persists rows with timestamps, files, and stable hashes", async () => {
    ws = workspace();
    const a = ws.seed(TWO_THREE_FOUR);
    const b = ws.seed(TWO_THREE_FOUR); // identical audio, different session
    await processJob(ws.db, a.jobId);
    await processJob(ws.db, b.jobId);
    const segsA = listSegments(ws.db, a.sessionId);
    const segsB = listSegments(ws.db, b.sessionId);
    expect(segsA).toHaveLength(2);
    expect(fs.existsSync(segmentPath(a.sessionId, 0))).toBe(true);
    // Same audio ⇒ identical content hashes, both within and across sessions.
    expect(segsA[0].contentHash).toBe(segsB[0].contentHash);
    expect(segsA[0].contentHash).not.toBe(segsA[1].contentHash);
  }, SLOW);

  it("criterion 5 — identical segments dedup to one cached rendition", async () => {
    ws = workspace();
    const a = ws.seed(TWO_THREE_FOUR);
    const b = ws.seed(TWO_THREE_FOUR);
    await processJob(ws.db, a.jobId);
    const hash = listSegments(ws.db, a.sessionId)[0].contentHash;
    const cachePath = renditionCachePath(hash, 1.5);
    expect(fs.existsSync(cachePath)).toBe(true);
    const before = mtime(cachePath);
    await processJob(ws.db, b.jobId); // identical audio — must reuse the cache
    expect(mtime(cachePath)).toBe(before); // not rewritten ⇒ cache hit
  }, SLOW);

  it("criterion 6 — renditions are time-compressed by the tempo factor", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    await processJob(ws.db, jobId, { tempo: 1.5 });
    const seg = listSegments(ws.db, sessionId)[1]; // the ~4s interval
    const segDur = await probeDuration(segmentPath(sessionId, seg.idx));
    const rendDur = await probeDuration(renditionCachePath(seg.contentHash, 1.5));
    expect(rendDur).toBeCloseTo(segDur / 1.5, 1);
  }, SLOW);

  it("criterion 7 — lifecycle to done; a corrupt input lands failed with a message", async () => {
    ws = workspace();
    const ok = ws.seed(TWO_THREE_FOUR);
    const done = await processJob(ws.db, ok.jobId);
    expect(done.state).toBe("done");
    expect(done.progress).toBe(1);
    expect(getSession(ws.db, ok.sessionId)?.jobState).toBe("done");

    const bad = ws.seedRaw(Buffer.from("this is definitely not audio"));
    const failed = await processJob(ws.db, bad.jobId);
    expect(failed.state).toBe("failed");
    expect(failed.error).toBeTruthy();
    expect(getSession(ws.db, bad.sessionId)?.jobState).toBe("failed");
    // No half-written success: the failed job is not claimed done.
    expect(fs.existsSync(normalizedPath(bad.sessionId))).toBe(false);
  }, SLOW);

  it("criterion 8 — resumes from a checkpoint without redoing or duplicating work", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);

    // Stop right after normalize; the expensive normalize output now exists.
    let job = await processJob(ws.db, jobId, { stopAfter: "normalizing" });
    expect(job.state).toBe("processing");
    expect(job.stage).toBe("detecting");
    const normMtime = mtime(normalizedPath(sessionId));

    // Stop after segmenting; two segments are on disk, none rendered yet.
    job = await processJob(ws.db, jobId, { stopAfter: "segmenting" });
    expect(job.stage).toBe("rendering");
    expect(listSegments(ws.db, sessionId)).toHaveLength(2);
    const segMtime = mtime(segmentPath(sessionId, 0));

    // Resume to completion: finished stages are skipped, nothing duplicated.
    job = await processJob(ws.db, jobId);
    expect(job.state).toBe("done");
    expect(listSegments(ws.db, sessionId)).toHaveLength(2);
    expect(mtime(normalizedPath(sessionId))).toBe(normMtime); // normalize skipped
    expect(mtime(segmentPath(sessionId, 0))).toBe(segMtime); // extraction skipped

    // Force a stale checkpoint back to segmenting; idempotent, still 2 rows.
    ws.db.prepare("UPDATE ingest_jobs SET state='processing', stage='segmenting' WHERE id=?").run(jobId);
    await processJob(ws.db, jobId);
    expect(listSegments(ws.db, sessionId)).toHaveLength(2);
  }, SLOW);

  it("criterion 9 — a 3-minute fixture yields the right segments via file I/O", async () => {
    ws = workspace();
    // 12 × ([12s tone][3s silence]) = 180s. 12 tones ≥ 2s ⇒ 12 kept segments.
    const parts: Part[] = [];
    for (let i = 0; i < 12; i++) {
      parts.push({ kind: "tone", seconds: 12 }, { kind: "silence", seconds: 3 });
    }
    const { jobId, sessionId } = ws.seed(parts);
    const job = await processJob(ws.db, jobId);
    expect(job.state).toBe("done");
    expect(listSegments(ws.db, sessionId)).toHaveLength(12);

    // Memory-safety is structural: no ingest module ever reads a whole file into
    // a Buffer — audio flows ffmpeg file→file and the hash is streamed.
    const ingestDir = path.join(process.cwd(), "lib", "ingest");
    for (const f of fs.readdirSync(ingestDir)) {
      const src = fs.readFileSync(path.join(ingestDir, f), "utf8");
      expect(src).not.toMatch(/readFile(Sync)?\s*\(/);
      expect(src).not.toMatch(/decodeAudioData|arrayBuffer\s*\(/);
    }
  }, SLOW);
});
