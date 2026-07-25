import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession, getSession, listSessions } from "@/lib/sessions";
import { probeCreationTime } from "@/lib/ffprobe";
import {
  captureLabel,
  capturePrecision,
  normalizeCapturedAt,
  parseContainerCreationTime,
} from "@/lib/capture-time";

// E-39 §B2 — the app claims a time only when it knows one.
//
// `sessions.created_at` is the UPLOAD instant and eight surfaces read it as the moment the
// learner spoke. The headline case — record at 08:10, upload at 21:30 — produced "this
// evening's recording", and an evening upload of the morning's speech landed on the wrong
// local day entirely. `sessions.captured_at` is the fact; NULL is the honest answer when
// nothing recorded it, and this file asserts BOTH directions: the claim is made when the
// time is known, and refused (never guessed from the upload) when it is not.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function freshDb(): Db {
  return openDatabase(path.join(tmp("erika-capture-"), "erika.db"));
}

describe("normalizeCapturedAt — what the app is willing to believe", () => {
  const NOW = Date.parse("2026-07-25T12:00:00Z");

  it("accepts an ISO instant and stores it as SQLite UTC text", () => {
    // Expectation from the fixture: 08:10 local +02:00 is 06:10 UTC.
    expect(normalizeCapturedAt("2026-07-25T08:10:00+02:00", NOW)).toBe("2026-07-25 06:10:00");
    expect(normalizeCapturedAt("2026-07-25T06:10:00Z", NOW)).toBe("2026-07-25 06:10:00");
  });

  it("accepts an OLD recording — uploading last year's audio is normal", () => {
    expect(normalizeCapturedAt("2019-03-04T21:00:00Z", NOW)).toBe("2019-03-04 21:00:00");
  });

  it("refuses a FUTURE instant rather than letting a wrong clock pin a session on top", () => {
    expect(normalizeCapturedAt("2093-01-01T00:00:00Z", NOW)).toBeNull();
    // A minute of skew is tolerated, since a client clock is never exact.
    expect(normalizeCapturedAt(new Date(NOW + 30_000).toISOString(), NOW)).not.toBeNull();
    expect(normalizeCapturedAt(new Date(NOW + 600_000).toISOString(), NOW)).toBeNull();
  });

  it("refuses what it cannot read, and refuses nothing at all", () => {
    for (const bad of ["", "not-a-date", null, undefined]) {
      expect(normalizeCapturedAt(bad, NOW)).toBeNull();
    }
  });
});

describe("parseContainerCreationTime — the recording device's own answer", () => {
  const NOW = Date.parse("2026-07-25T12:00:00Z");

  it("takes a real container tag", () => {
    expect(parseContainerCreationTime("2026-07-25T06:10:00.000000Z", NOW)).toBe("2026-07-25 06:10:00");
  });

  it("refuses the epoch placeholder some encoders write", () => {
    // Not a recording made in 1970; a field the encoder left blank.
    expect(parseContainerCreationTime("1970-01-01T00:00:00.000000Z", NOW)).toBeNull();
  });

  it("refuses an absent or unreadable tag", () => {
    expect(parseContainerCreationTime(null, NOW)).toBeNull();
    expect(parseContainerCreationTime("   ", NOW)).toBeNull();
    expect(parseContainerCreationTime("whenever", NOW)).toBeNull();
  });
});

describe("capturePrecision / captureLabel — the screen never says 'captured' about an upload", () => {
  it("names each instant for what it is", () => {
    expect(capturePrecision("2026-07-25 06:10:00")).toBe("captured");
    expect(captureLabel("2026-07-25 06:10:00")).toBe("Captured");
    expect(capturePrecision(null)).toBe("uploaded");
    expect(captureLabel(null)).toBe("Uploaded");
  });
});

describe("the session row records capture time, or an honest null", () => {
  it("stores a capture time when one is supplied, and null when none is", () => {
    const db = freshDb();
    createSession(db, {
      id: "recorded",
      originalFilename: "Recording 2026-07-25 at 08.10.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
      capturedAt: "2026-07-25 06:10:00",
    });
    createSession(db, {
      id: "picked",
      originalFilename: "voice-memo.mp3",
      format: "mp3",
      sizeBytes: 1,
      durationSeconds: 60,
    });

    expect(getSession(db, "recorded")!.capturedAt).toBe("2026-07-25 06:10:00");
    // The one thing that must never happen: a null quietly becoming the upload instant.
    expect(getSession(db, "picked")!.capturedAt).toBeNull();
    expect(getSession(db, "picked")!.createdAt).not.toBeNull();
    db.close();
  });

  it("orders the sessions list by when the learner SPOKE, not when the file arrived", () => {
    const db = freshDb();
    // The headline day-dump case: the morning's speech, uploaded after dinner, next to a
    // take recorded at lunchtime. `created_at` is "now" for both, so only capture time can
    // put them in the order the learner lived them.
    createSession(db, {
      id: "morning-dump",
      originalFilename: "day.m4a",
      format: "m4a",
      sizeBytes: 1,
      durationSeconds: 60,
      capturedAt: "2026-07-25 06:10:00",
    });
    createSession(db, {
      id: "lunch-take",
      originalFilename: "lunch.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
      capturedAt: "2026-07-25 11:30:00",
    });
    expect(listSessions(db).map((s) => s.id)).toEqual(["lunch-take", "morning-dump"]);
    db.close();
  });

  it("still lists a session whose capture time is unknown — refusing to file it would lose it", () => {
    const db = freshDb();
    createSession(db, {
      id: "known",
      originalFilename: "a.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
      capturedAt: "2020-01-01 00:00:00",
    });
    createSession(db, {
      id: "unknown",
      originalFilename: "b.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
    });
    // Both present. The unknown one files under its upload instant ("now"), which is
    // later than 2020, so it sorts first — and it is LABELLED as an upload, not a capture.
    expect(listSessions(db).map((s) => s.id).sort()).toEqual(["known", "unknown"]);
    expect(captureLabel(getSession(db, "unknown")!.capturedAt)).toBe("Uploaded");
    db.close();
  });
});

describe("the ingest path resolves capture time in one place", () => {
  // `finalizeStagedUpload` reaches the process-wide `getDb()`, so the DB path has to be
  // pointed at a temp dir BEFORE the module graph loads — the archive-route pattern.
  // A disposable DB only; `data/erika.db` is never opened.
  let root: string;
  let finalize: typeof import("@/lib/finalize-upload").finalizeStagedUpload;

  beforeAll(async () => {
    root = tmp("erika-finalize-");
    process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
    process.env.ERIKA_DATA_DIR = root;
    finalize = (await import("@/lib/finalize-upload")).finalizeStagedUpload;
  });
  afterAll(() => {
    delete process.env.ERIKA_DB_PATH;
    delete process.env.ERIKA_DATA_DIR;
  });

  /** A real audio file, optionally carrying a container `creation_time` tag. */
  function audioFile(dest: string, iso?: string): number {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ac", "1", "-ar", "8000",
        ...(iso ? ["-metadata", `creation_time=${iso}`] : []),
        dest,
      ],
      { stdio: "ignore" },
    );
    return fs.statSync(dest).size;
  }

  it("reads the container's creation_time when the client supplied nothing", async () => {
    // Expectation from the fixture: the tag we WROTE, not the instant of this test run.
    const staged = path.join(root, "sessions", "cap", "source.m4a");
    const size = audioFile(staged, "2026-07-25T06:10:00.000000Z");
    // Prove the premise: the tag really is in the file, else this test cannot fail.
    expect(await probeCreationTime(staged)).toContain("2026-07-25T06:10:00");

    const session = await finalize({
      id: "cap",
      filename: "day.m4a",
      format: "m4a",
      sourceFile: staged,
      sizeBytes: size,
    });
    expect(session.capturedAt).toBe("2026-07-25 06:10:00");
  });

  it("prefers the app's own measured capture instant over the container's", async () => {
    const staged = path.join(root, "sessions", "both", "source.m4a");
    const size = audioFile(staged, "2020-01-01T00:00:00.000000Z");
    const session = await finalize({
      id: "both",
      filename: "take.m4a",
      format: "m4a",
      sourceFile: staged,
      sizeBytes: size,
      capturedAt: "2026-07-25T06:10:00Z",
    });
    // The recorder measured it; the container tag here is a transcode artefact.
    expect(session.capturedAt).toBe("2026-07-25 06:10:00");
  });

  it("stores NULL — not the upload instant — for a file that carries no capture time", async () => {
    const staged = path.join(root, "sessions", "bare", "source.wav");
    const size = audioFile(staged);
    const session = await finalize({
      id: "bare",
      filename: "bare.wav",
      format: "wav",
      sourceFile: staged,
      sizeBytes: size,
    });
    expect(session.capturedAt).toBeNull();
    expect(captureLabel(session.capturedAt)).toBe("Uploaded");
  });

  it("refuses a client clock set to the future rather than trusting it", async () => {
    const staged = path.join(root, "sessions", "skew", "source.wav");
    const size = audioFile(staged);
    const session = await finalize({
      id: "skew",
      filename: "skew.wav",
      format: "wav",
      sourceFile: staged,
      sizeBytes: size,
      capturedAt: "2093-01-01T00:00:00Z",
    });
    expect(session.capturedAt).toBeNull();
  });
});
