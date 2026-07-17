import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { claimNextJob, getJob, reclaimStuckJobs } from "@/lib/ingest/pipeline";

// The worker's job-selection logic (no ffmpeg): atomic queued→processing claim
// and crash recovery of jobs left in `processing`.

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-worker-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seedSession(db: ReturnType<typeof openDatabase>, id: string): string {
  createSession(db, { id, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 1 });
  const jobId = (db.prepare("SELECT id FROM ingest_jobs WHERE session_id = ?").get(id) as { id: string }).id;
  // Give the job a distinct created_at so "oldest queued" is unambiguous.
  db.prepare("UPDATE ingest_jobs SET created_at = ? WHERE id = ?").run(`2020-01-01 00:00:0${id}`, jobId);
  return jobId;
}

describe("worker job selection", () => {
  it("claims the oldest queued job atomically and marks it processing", () => {
    const db = freshDb();
    const j1 = seedSession(db, "1");
    const j2 = seedSession(db, "2");
    const first = claimNextJob(db);
    expect(first).toBe(j1); // oldest by created_at
    expect(getJob(db, j1)?.state).toBe("processing");
    expect(getJob(db, j1)?.stage).toBe("normalizing");
    const second = claimNextJob(db);
    expect(second).toBe(j2);
    expect(claimNextJob(db)).toBeNull(); // queue drained
    db.close();
  });

  it("reclaims jobs a crash left in processing", () => {
    const db = freshDb();
    const j1 = seedSession(db, "1");
    seedSession(db, "2");
    claimNextJob(db); // j1 → processing (simulates a crash mid-flight)
    expect(reclaimStuckJobs(db)).toEqual([j1]);
    db.close();
  });
});
