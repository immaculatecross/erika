import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { createSession, deleteSession, getSession, listSessions } from "@/lib/sessions";
import { probeDurationSeconds, FfprobeError } from "@/lib/ffprobe";
import { formatBytes, formatDuration, formatEstimate } from "@/lib/format";
import { makeWav, tmpDir } from "./helpers";

const dirs: string[] = [];
function freshDb() {
  const dir = tmpDir("erika-sess-");
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const base = { originalFilename: "take.wav", format: "wav" as const, sizeBytes: 1000, durationSeconds: 12 };

describe("migration v2 schema", () => {
  it("creates sessions and ingest_jobs", () => {
    const db = freshDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("sessions");
    expect(tables).toContain("ingest_jobs");
    db.close();
  });
});

describe("sessions data layer", () => {
  it("creating a session persists its fields and one queued job (criterion 3, 6)", () => {
    const db = freshDb();
    const s = createSession(db, { id: "s1", ...base });
    expect(s).toMatchObject({ ...base, id: "s1", jobState: "queued" });
    expect(s.createdAt).toBeTruthy();
    const jobs = db.prepare("SELECT state FROM ingest_jobs WHERE session_id = 's1'").all();
    expect(jobs).toEqual([{ state: "queued" }]);
    db.close();
  });

  it("lists sessions newest-first (criterion 4)", () => {
    const db = freshDb();
    createSession(db, { id: "a", ...base });
    db.prepare("UPDATE sessions SET created_at = '2020-01-01 00:00:00' WHERE id = 'a'").run();
    createSession(db, { id: "b", ...base });
    db.prepare("UPDATE sessions SET created_at = '2030-01-01 00:00:00' WHERE id = 'b'").run();
    expect(listSessions(db).map((s) => s.id)).toEqual(["b", "a"]);
    db.close();
  });

  it("deleting a session removes its rows and cascades its job (criterion 7)", () => {
    const db = freshDb();
    createSession(db, { id: "s1", ...base });
    expect(deleteSession(db, "s1")).toBe(true);
    expect(getSession(db, "s1")).toBeNull();
    const jobCount = db.prepare("SELECT COUNT(*) AS n FROM ingest_jobs").get() as { n: number };
    expect(jobCount.n).toBe(0);
    expect(deleteSession(db, "s1")).toBe(false);
    db.close();
  });
});

describe("ffprobe", () => {
  it("reads a real duration from decodable audio (criterion 3)", async () => {
    const dir = tmpDir("erika-probe-");
    dirs.push(dir);
    const wav = path.join(dir, "a.wav");
    makeWav(wav, 1);
    const seconds = await probeDurationSeconds(wav);
    expect(seconds).toBeGreaterThan(0.8);
    expect(seconds).toBeLessThan(1.5);
  });

  it("rejects an undecodable file (criterion 2)", async () => {
    const dir = tmpDir("erika-probe-");
    dirs.push(dir);
    const bad = path.join(dir, "corrupt.wav");
    fs.writeFileSync(bad, Buffer.from("this is not audio at all"));
    await expect(probeDurationSeconds(bad)).rejects.toBeInstanceOf(FfprobeError);
  });
});

describe("format helpers", () => {
  it("formats duration with tabular hh:mm:ss past an hour", () => {
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
  it("formats bytes compactly", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("[P4] renders a sub-cent estimate as <1¢, a cent-or-more as $X.XX", () => {
    expect(formatEstimate(0.002)).toBe("<1¢");
    expect(formatEstimate(0)).toBe("<1¢");
    expect(formatEstimate(0.009)).toBe("<1¢");
    expect(formatEstimate(0.01)).toBe("$0.01");
    expect(formatEstimate(0.02)).toBe("$0.02");
    expect(formatEstimate(1.2)).toBe("$1.20");
  });
});
