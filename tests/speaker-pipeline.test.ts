import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processJob } from "@/lib/ingest/pipeline";
import { listSegments } from "@/lib/segments";
import { ensureEnrollmentDir, enrollmentPath } from "@/lib/audio-storage";
import { newEnrollmentId, recordEnrollment } from "@/lib/placement/enrollment";
import type { SpeakerEmbedder } from "@/lib/speaker";
import { makeWav } from "./helpers";
import { cleanup, workspace, type Part, type Workspace } from "./fixtures";

// E-36 criterion 2 at the pipeline level: the `attributing` stage scores each
// segment against the enrolled reference and persists a per-segment verdict, is
// checkpointed/resumable, and DEGRADES honestly (no enrollment / filter off ⇒ every
// segment unattributed, treated as the user). A mock embedder keeps it network- and
// model-free; real ffmpeg still extracts the segments and probes the enrollment take.

const SLOW = 120_000;
const TWO_THREE_FOUR: Part[] = [
  { kind: "tone", seconds: 2 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 4 },
];

const USER = Float32Array.from([1, 0]);
const OTHER = Float32Array.from([0, 1]);

/** A mock embedder: the enrollment take and even-indexed segments read as the USER;
 *  odd-indexed segments read as another speaker. So the reference centroid is USER,
 *  seg 0 (even) is the user, seg 1 (odd) is a bystander. */
const mockEmbedder: SpeakerEmbedder = {
  id: "mock-pipeline",
  isAvailable: () => true,
  async embed(wavPath) {
    if (wavPath.includes("enrollment")) return USER;
    const m = wavPath.match(/seg-(\d+)\.wav$/);
    const idx = m ? Number(m[1]) : 0;
    return idx % 2 === 0 ? USER : OTHER;
  },
};

let ws: Workspace;
afterEach(() => {
  delete process.env.ERIKA_SPEAKER_FILTER;
  if (ws) cleanup(ws);
});

/** Stage a real enrollment take on disk + its DB row, under the workspace data dir. */
async function enroll(db: Workspace["db"]): Promise<void> {
  const id = newEnrollmentId();
  await ensureEnrollmentDir();
  const p = enrollmentPath(id, "wav");
  makeWav(p, 6);
  recordEnrollment(db, { id, path: p, format: "wav", durationSeconds: 6, sizeBytes: fs.statSync(p).size });
}

describe("E-36 attributing stage", () => {
  it("attributes each segment against the enrolled reference and caches it", async () => {
    ws = workspace();
    await enroll(ws.db);
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    const job = await processJob(ws.db, jobId, {}, mockEmbedder);
    expect(job.state).toBe("done");

    const segs = listSegments(ws.db, sessionId);
    expect(segs).toHaveLength(2);
    expect(segs[0].isUser).toBe(1); // even ⇒ the user
    expect(segs[0].speakerScore).toBeCloseTo(1, 5);
    expect(segs[1].isUser).toBe(0); // odd ⇒ a bystander
    expect(segs[1].speakerScore).toBeCloseTo(0, 5);

    // The reference centroid was cached under (enrollment_id, embedder_id).
    const refs = ws.db.prepare("SELECT COUNT(*) AS n FROM speaker_references WHERE embedder_id = 'mock-pipeline'").get() as { n: number };
    expect(refs.n).toBe(1);
  }, SLOW);

  it("degrades to unattributed when there is no enrollment", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR); // no enroll() call
    await processJob(ws.db, jobId, {}, mockEmbedder);
    for (const s of listSegments(ws.db, sessionId)) {
      expect(s.isUser).toBeNull(); // treated as the user downstream
      expect(s.speakerScore).toBeNull();
    }
  }, SLOW);

  it("the kill-switch disables attribution entirely", async () => {
    ws = workspace();
    await enroll(ws.db);
    process.env.ERIKA_SPEAKER_FILTER = "off";
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    await processJob(ws.db, jobId, {}, mockEmbedder);
    for (const s of listSegments(ws.db, sessionId)) expect(s.isUser).toBeNull();
  }, SLOW);

  it("with no embedder injected (the pre-E-36 caller) nothing is attributed", async () => {
    ws = workspace();
    await enroll(ws.db);
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    await processJob(ws.db, jobId); // no embedder param
    for (const s of listSegments(ws.db, sessionId)) expect(s.isUser).toBeNull();
  }, SLOW);

  it("checkpoints the attributing stage (resumable)", async () => {
    ws = workspace();
    await enroll(ws.db);
    const { jobId, sessionId } = ws.seed(TWO_THREE_FOUR);
    const job = await processJob(ws.db, jobId, { stopAfter: "attributing" }, mockEmbedder);
    expect(job.state).toBe("processing");
    expect(job.stage).toBe("rendering"); // the next stage
    // Verdicts were written before the checkpoint.
    expect(listSegments(ws.db, sessionId)[0].isUser).toBe(1);
    // Resume to completion.
    expect((await processJob(ws.db, jobId, {}, mockEmbedder)).state).toBe("done");
  }, SLOW);
});
