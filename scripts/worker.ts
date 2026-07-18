import { loadEnvLocal, startupEnvError } from "../lib/env-file";
import { getDb } from "../lib/db";
import { claimNextJob, processJob, reclaimStuckJobs } from "../lib/ingest/pipeline";
import {
  claimNextAnalysisJob,
  reclaimStuckAnalysisJobs,
  runAnalysisJob,
} from "../lib/analysis/cascade";
import { openAiAudioModel } from "../lib/analysis/audio-model";

// `npm run worker`: a thin loop around processJob (E-3 ingest) and runAnalysisJob
// (E-4 analysis — the real OpenAI cascade). Every claim takes a heartbeat lease
// under this process's worker identity (lib/jobs/lease.ts), so a reclaim on each
// tick only picks up jobs whose lease has gone STALE — a second worker can no
// longer re-run a job the first is still executing (E-16 defect 2). A genuinely
// abandoned job is still resumed (checkpointed / hash-cached, so no redone,
// duplicated, or re-billed work). Set ERIKA_WORKER_ONCE=1 to exit once both
// queues are empty (used for verification); otherwise it polls. All logging goes
// to stderr — stdout clean.
//
// This is a plain Node process, not Next, so nothing loads `.env.local` for it
// (E-16b criterion 1): the loader runs FIRST, before any module reads a secret,
// and a missing OPENAI_API_KEY stops the worker at boot with the fix in the
// message rather than failing obscurely at the first model call.

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
  const applied = loadEnvLocal();
  const envError = startupEnvError();
  if (envError) {
    console.error(envError);
    process.exit(1);
  }
  const db = getDb();
  console.error(`[worker] started (${applied.length} var(s) from .env.local)`);
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
