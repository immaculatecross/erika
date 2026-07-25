import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { enqueueAnalysis, getAnalysisJob } from "@/lib/analysis/cascade";
import { getJob } from "@/lib/ingest/pipeline";
import { listSegments } from "@/lib/segments";
import { segmentPath } from "@/lib/audio-storage";
import { analysisUnavailableMessage, REQUIRED_KEY } from "@/lib/env-file";
import { cleanup, workspace, type Part, type Workspace } from "./fixtures";

// RETRO-004 §DE-1, the cold-start gate. The defect was not in a function — it was in
// the PROCESS: `npm run worker` exited 1 without an OPENAI_API_KEY, so a keyless
// install could never ingest anything, and the app's own instruction ("start the
// worker with `npm run worker`") was a closed loop. So this test drives the ACTUAL
// worker path: it spawns `scripts/worker.ts` as a real child process with the key
// scrubbed from its environment, exactly as a new user's terminal would, and asserts
// the queue drains.
//
// A unit test on the env helper could not have caught this and cannot prove it fixed.
// Everything lives in an OS temp dir under ERIKA_DATA_DIR/ERIKA_DB_PATH — never data/.

const SLOW = 180_000;
const WORKER = path.join(process.cwd(), "scripts", "worker.ts");
const TAKE: Part[] = [
  { kind: "tone", seconds: 3 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 3 },
];

let ws: Workspace;
afterEach(() => {
  if (ws) cleanup(ws);
});

interface Run {
  status: number | null;
  stderr: string;
}

/** Run the real worker to queue-exhaustion with NO api key in its environment. */
function runWorkerKeyless(dir: string): Run {
  const env = { ...process.env };
  delete env[REQUIRED_KEY]; // the cold-start condition, verbatim
  env.ERIKA_DATA_DIR = dir;
  env.ERIKA_DB_PATH = path.join(dir, "erika.db");
  env.ERIKA_WORKER_ONCE = "1"; // drain both queues, then exit
  const r = spawnSync("npx", ["tsx", WORKER], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: SLOW - 20_000,
  });
  return { status: r.status, stderr: `${r.stderr ?? ""}` };
}

describe("cold start with no API key — the worker drains ingest (RETRO-004 §DE-1)", () => {
  it("an uploaded take reaches a completed ingest with segments, driven by the real worker", async () => {
    ws = workspace();
    const { sessionId, jobId } = ws.seed(TAKE);
    // The state a new user is left in: a queued job and nothing else.
    expect(getJob(ws.db, jobId)!.state).toBe("queued");
    expect(listSegments(ws.db, sessionId)).toHaveLength(0);

    const run = runWorkerKeyless(ws.dir);

    // 1. The worker did not refuse to start. (It exited 1 here before this fix, with
    //    the queue untouched — the entire defect, in one assertion.)
    expect(run.status).toBe(0);
    // 2. It said what is true: ingest runs, analysis does not.
    expect(run.stderr).toMatch(/ingest will run normally/i);
    expect(run.stderr).toMatch(/analysis is unavailable/i);
    expect(run.stderr).toMatch(/analysis=unavailable \(no key\)/);

    // 3. The learner has their session: ingest DONE, not stuck at "Queued 0%".
    const reread = openDatabase(path.join(ws.dir, "erika.db"));
    const job = getJob(reread, jobId)!;
    expect(job.state).toBe("done");
    expect(job.progress).toBe(1);
    // 4. …with real speech extracted — the two tones, the silence discarded.
    const segments = listSegments(reread, sessionId);
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) {
      expect(s.durationMs).toBeGreaterThan(0);
      // The audio they can actually play back, on disk under the temp data dir.
      expect(fs.existsSync(segmentPath(sessionId, s.idx))).toBe(true);
    }
    reread.close();
  }, SLOW);

  it("an analysis job fails honestly and terminally, and the worker keeps working", async () => {
    ws = workspace();
    const first = ws.seed(TAKE);
    runWorkerKeyless(ws.dir); // ingest the first take so analysis has segments

    const reread = openDatabase(path.join(ws.dir, "erika.db"));
    expect(listSegments(reread, first.sessionId).length).toBeGreaterThan(0);
    const analysisId = enqueueAnalysis(reread, first.sessionId).id;
    reread.close();

    // Queue a SECOND ingest alongside the doomed analysis job: the refusal must not
    // stop the worker or block other work.
    const second = ws.seed(TAKE);

    const run = runWorkerKeyless(ws.dir);
    expect(run.status).toBe(0); // the process survived the refusal

    const after = openDatabase(path.join(ws.dir, "erika.db"));
    const analysis = getAnalysisJob(after, analysisId)!;
    // Terminal for THIS job, with the truth and the fix in the message.
    expect(analysis.state).toBe("failed");
    expect(analysis.error).toBe(analysisUnavailableMessage());
    expect(analysis.error).toContain(REQUIRED_KEY);
    // Never "right now": the condition is permanent until the user acts (§DE-3).
    expect(analysis.error).not.toMatch(/right now/i);
    // Not a retry loop: `failed` is claimed by neither the queued claim nor the stale
    // reclaim, so a further worker run leaves it exactly where it is.
    const secondRun = runWorkerKeyless(ws.dir);
    expect(secondRun.status).toBe(0);

    // And the other work went through.
    const after2 = openDatabase(path.join(ws.dir, "erika.db"));
    expect(getJob(after2, second.jobId)!.state).toBe("done");
    expect(listSegments(after2, second.sessionId).length).toBeGreaterThan(0);
    const stillFailed = getAnalysisJob(after2, analysisId)!;
    expect(stillFailed.state).toBe("failed");
    after.close();
    after2.close();
  }, SLOW);
});
