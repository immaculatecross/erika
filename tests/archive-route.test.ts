import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { ArchiveEntry } from "@/lib/archive";

// The Speech archive read route + its session-joined accessor (E-11 criterion 1).
// listIncludedFindingsWithSession joins each finding to its session's capture date; the
// route builds the chronological timeline (newest session first, startMs ascending
// within a session). Real DB under a throwaway dir; env set before the lazy getDb()
// binds, as in the phrasebook-route test.

let root: string;
let archiveGET: typeof import("@/app/api/archive/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let listIncludedFindingsWithSession: typeof import("@/lib/findings-model").listIncludedFindingsWithSession;

beforeAll(async () => {
  root = tmpDir("erika-archive-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  archiveGET = (await import("@/app/api/archive/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  const findings = await import("@/lib/analysis/findings");
  persistSegmentFindings = findings.persistSegmentFindings;
  listIncludedFindingsWithSession = (await import("@/lib/findings-model")).listIncludedFindingsWithSession;
});

afterEach(() => getDb().prepare("DELETE FROM sessions").run());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** Seed a session at a fixed capture date with findings at the given startMs. */
function seed(sessionId: string, createdAt: string, starts: number[]) {
  createSession(getDb(), { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  // createSession stamps created_at with datetime('now'); pin it for deterministic order.
  getDb().prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(createdAt, sessionId);
  for (const startMs of starts) {
    persistSegmentFindings(getDb(), {
      sessionId,
      contentHash: `${sessionId}-h${seq++}`,
      flagged: true,
      deepDone: true,
      findings: [
        { quote: `q@${startMs}`, correction: `c@${startMs}`, category: "grammar", explanation: "why", severity: "high", startMs, endMs: startMs + 500 },
      ],
    });
  }
}

async function getEntries(): Promise<ArchiveEntry[]> {
  return (await (await archiveGET()).json()).entries as ArchiveEntry[];
}

describe("listIncludedFindingsWithSession", () => {
  it("joins each finding to its session's capture date and filename", () => {
    seed("s1", "2026-07-10 09:00:00", [1000]);
    const rows = listIncludedFindingsWithSession(getDb());
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionCreatedAt).toBe("2026-07-10 09:00:00");
    expect(rows[0].sessionFilename).toBe("s1.wav");
    expect(rows[0].startMs).toBe(1000);
  });
});

describe("GET /api/archive", () => {
  it("returns the timeline newest session first, startMs ascending within a session", async () => {
    seed("older", "2026-07-10 09:00:00", [3000, 1000]);
    seed("newer", "2026-07-12 09:00:00", [2000]);

    const entries = await getEntries();
    // newer session's moment first, then the older session in spoken order.
    expect(entries.map((e) => e.sessionId)).toEqual(["newer", "older", "older"]);
    expect(entries.map((e) => e.startMs)).toEqual([2000, 1000, 3000]);
    expect(entries[0]).toHaveProperty("quote");
    expect(entries[0]).toHaveProperty("correction");
  });

  it("serves an empty timeline when nothing is analyzed", async () => {
    expect(await getEntries()).toHaveLength(0);
  });
});
