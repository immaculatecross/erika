import { getDb } from "../lib/db";
import { claimNextJob, processJob, reclaimStuckJobs } from "../lib/ingest/pipeline";
import {
  claimNextAnalysisJob,
  reclaimStuckAnalysisJobs,
  runAnalysisJob,
} from "../lib/analysis/cascade";
import { openAiAudioModel } from "../lib/analysis/audio-model";

// `npm run worker`: a thin loop around processJob (E-3 ingest) and runAnalysisJob
// (E-4 analysis — the real OpenAI cascade). On start it reclaims any job a
// previous crash left in `processing` and resumes it (checkpointed / hash-cached,
// so no redone, duplicated, or re-billed work), then drains the oldest queued
// jobs. Set ERIKA_WORKER_ONCE=1 to exit once both queues are empty (used for
// verification); otherwise it polls. All logging goes to stderr — stdout clean.

const POLL_MS = Number(process.env.ERIKA_WORKER_POLL_MS ?? 1000);
const ONCE = process.env.ERIKA_WORKER_ONCE === "1";

async function runOne(db: ReturnType<typeof getDb>, id: string): Promise<void> {
  console.error(`[worker] ingest job ${id}`);
  const job = await processJob(db, id);
  if (job.state === "failed") console.error(`[worker] ingest ${id} failed: ${job.error}`);
  else console.error(`[worker] ingest ${id} → ${job.state}`);
}

async function runAnalysis(db: ReturnType<typeof getDb>, id: string): Promise<void> {
  console.error(`[worker] analysis job ${id}`);
  const job = await runAnalysisJob(db, id, openAiAudioModel);
  if (job.state === "failed" || job.state === "halted") {
    console.error(`[worker] analysis ${id} ${job.state}: ${job.error}`);
  } else {
    console.error(`[worker] analysis ${id} → ${job.state}`);
  }
}

async function tick(db: ReturnType<typeof getDb>): Promise<boolean> {
  for (const id of reclaimStuckJobs(db)) await runOne(db, id); // crash recovery first
  for (const id of reclaimStuckAnalysisJobs(db)) await runAnalysis(db, id);
  const next = claimNextJob(db);
  if (next) {
    await runOne(db, next);
    return true;
  }
  const nextAnalysis = claimNextAnalysisJob(db);
  if (nextAnalysis) {
    await runAnalysis(db, nextAnalysis);
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const db = getDb();
  console.error("[worker] started");
  for (;;) {
    const didWork = await tick(db);
    if (!didWork) {
      if (ONCE) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  console.error("[worker] idle — exiting");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
