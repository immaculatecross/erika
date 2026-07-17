import { getDb } from "../lib/db";
import { claimNextJob, processJob, reclaimStuckJobs } from "../lib/ingest/pipeline";

// `npm run worker`: a thin loop around processJob. On start it reclaims any job
// a previous crash left in `processing` and resumes it (checkpointed, so no
// redone or duplicated work), then drains the oldest queued jobs. Set
// ERIKA_WORKER_ONCE=1 to exit once the queue is empty (used for verification);
// otherwise it polls. All logging goes to stderr — stdout stays clean.

const POLL_MS = Number(process.env.ERIKA_WORKER_POLL_MS ?? 1000);
const ONCE = process.env.ERIKA_WORKER_ONCE === "1";

async function runOne(db: ReturnType<typeof getDb>, id: string): Promise<void> {
  console.error(`[worker] processing job ${id}`);
  const job = await processJob(db, id);
  if (job.state === "failed") console.error(`[worker] job ${id} failed: ${job.error}`);
  else console.error(`[worker] job ${id} → ${job.state}`);
}

async function tick(db: ReturnType<typeof getDb>): Promise<boolean> {
  for (const id of reclaimStuckJobs(db)) await runOne(db, id); // crash recovery first
  const next = claimNextJob(db);
  if (next) {
    await runOne(db, next);
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
