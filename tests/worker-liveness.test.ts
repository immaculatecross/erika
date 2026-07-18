import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { claimNextJob } from "@/lib/ingest/pipeline";
import { heartbeat, JOB_LEASE_STALE_MS } from "@/lib/jobs/lease";
import {
  isWorkerAbsent,
  parseSqliteTime,
  QUEUED_STALE_MS,
  workerAbsent,
  WORKER_ABSENT_MESSAGE,
} from "@/lib/jobs/liveness";
import { pollAction } from "@/lib/poll";
import { tmpDir } from "./helpers";

// E-16b criterion 2: an upload sat `queued` forever under a calm badge because
// the app never said the work happens in a separate `npm run worker` process.
// Also criterion 6's polling half — a deleted session must stop the loop.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = tmpDir("erika-liveness-");
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const NOW = Date.parse("2026-07-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString().replace("T", " ").slice(0, 19);

describe("parseSqliteTime", () => {
  it("reads SQLite's UTC datetime text", () => {
    expect(parseSqliteTime("2026-07-18 12:00:00")).toBe(NOW);
    expect(parseSqliteTime(null)).toBeNull();
    expect(parseSqliteTime("not a time")).toBeNull();
  });
});

describe("workerAbsent (pure verdict)", () => {
  const queued = (updatedAt: string) => ({ state: "queued", createdAt: updatedAt, updatedAt, heartbeatAt: null });

  it("says nothing while a queued job is still fresh", () => {
    expect(workerAbsent(queued(ago(2000)), NOW)).toBe(false);
  });

  it("reports a queued job that has sat past the threshold", () => {
    // A running worker claims the oldest queued row within about a second.
    expect(workerAbsent(queued(ago(QUEUED_STALE_MS + 1000)), NOW)).toBe(true);
  });

  it("leaves a live processing job alone, however long it has been running", () => {
    const job = { state: "processing", createdAt: ago(6 * 3600_000), updatedAt: ago(6 * 3600_000), heartbeatAt: ago(3000) };
    expect(workerAbsent(job, NOW)).toBe(false);
  });

  it("reports a processing job whose heartbeat went stale", () => {
    const job = {
      state: "processing",
      createdAt: ago(3600_000),
      updatedAt: ago(3600_000),
      heartbeatAt: ago(JOB_LEASE_STALE_MS + 60_000),
    };
    expect(workerAbsent(job, NOW)).toBe(true);
  });

  it("never fires on a terminal job — those are not waiting on anyone", () => {
    for (const state of ["done", "failed", "halted"]) {
      expect(workerAbsent({ state, createdAt: ago(1e9), updatedAt: ago(1e9), heartbeatAt: null }, NOW)).toBe(false);
    }
  });

  it("gives the benefit of the doubt when timestamps are unreadable", () => {
    expect(workerAbsent({ state: "queued", createdAt: null, updatedAt: null, heartbeatAt: null }, NOW)).toBe(false);
  });
});

describe("isWorkerAbsent against real job rows", () => {
  function seededJob(db: Db): string {
    createSession(db, { id: "s1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 10 });
    return (db.prepare("SELECT id FROM ingest_jobs WHERE session_id = 's1'").get() as { id: string }).id;
  }

  it("a freshly queued job is quiet; the same job hours later is not", () => {
    const db = freshDb();
    const id = seededJob(db);
    expect(isWorkerAbsent(db, "ingest_jobs", id)).toBe(false);

    db.prepare("UPDATE ingest_jobs SET created_at = datetime('now','-2 hours'), updated_at = datetime('now','-2 hours') WHERE id = ?").run(id);
    expect(isWorkerAbsent(db, "ingest_jobs", id)).toBe(true);
    db.close();
  });

  it("a job a worker just claimed and is beating on is quiet", () => {
    const db = freshDb();
    const id = seededJob(db);
    db.prepare("UPDATE ingest_jobs SET created_at = datetime('now','-2 hours') WHERE id = ?").run(id);
    expect(claimNextJob(db, "w1")).toBe(id);
    heartbeat(db, "ingest_jobs", id);
    expect(isWorkerAbsent(db, "ingest_jobs", id)).toBe(false);
    db.close();
  });

  it("names the command in the message the UI shows", () => {
    expect(WORKER_ABSENT_MESSAGE).toContain("npm run worker");
    expect(WORKER_ABSENT_MESSAGE).toMatch(/^Not processing/);
  });
});

describe("pollAction (criterion 6)", () => {
  it("stops on a deleted session rather than polling a 404 forever", () => {
    expect(pollAction(404)).toBe("stop");
    expect(pollAction(410)).toBe("stop");
  });

  it("keeps retrying a transient failure — the run is still real", () => {
    expect(pollAction(500)).toBe("retry");
    expect(pollAction(502)).toBe("retry");
  });

  it("uses a successful body", () => {
    expect(pollAction(200)).toBe("use");
  });
});
