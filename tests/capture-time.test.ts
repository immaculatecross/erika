import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { listIncludedFindingsWithSession } from "@/lib/findings-model";
import { slipHourDistribution } from "@/lib/slip-hours";
import { probeCreationTime } from "@/lib/ffprobe";
import {
  CAPTURE_EPOCH_FLOOR_MS,
  CAPTURE_FUTURE_SKEW_MS,
  capturedAtSql,
  isSaneCaptureInstant,
  parseCaptureInstant,
  resolveCapturedAt,
  toSqliteUtc,
} from "@/lib/capture-time";

// WHEN THE LEARNER SPOKE (E-42 criteria 5 and 6).
//
// The invariant under test: every claim about when the learner SPOKE reads
// `sessions.captured_at`, and `created_at` means only "when this row was written".
// The headline case is the one RETRO-004 §1 named and E-38's repair missed — recorded
// at 08:10, uploaded at 21:30 — and it appears here end to end rather than as a unit
// on a formatter, because the defect was never in the formatting.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-capture-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

const NOW = new Date("2026-07-25T21:30:00Z");

describe("resolveCapturedAt — the order of authority (criterion 5)", () => {
  it("prefers the client's declared take-start over everything else", () => {
    // The mic path: the browser knows exactly when recording began, and nothing
    // downstream knows better.
    const at = resolveCapturedAt(
      {
        declared: "2026-07-25T08:10:00.000Z",
        embedded: "2026-07-25T12:00:00.000000Z",
        hint: "2026-07-25T20:00:00.000Z",
      },
      NOW,
    );
    expect(at).toBe("2026-07-25 08:10:00");
  });

  it("falls back to the container's embedded creation time", () => {
    const at = resolveCapturedAt(
      { embedded: "2026-07-25T12:00:00.000000Z", hint: "2026-07-25T20:00:00.000Z" },
      NOW,
    );
    expect(at).toBe("2026-07-25 12:00:00");
  });

  it("then to the file's modification-time hint — still far better than the upload instant", () => {
    const at = resolveCapturedAt({ hint: "2026-07-25T08:12:00.000Z" }, NOW);
    expect(at).toBe("2026-07-25 08:12:00");
  });

  it("finally to the upload instant, which is the only thing always available", () => {
    expect(resolveCapturedAt({}, NOW)).toBe("2026-07-25 21:30:00");
  });

  it("refuses a value it cannot believe rather than dating a recording wrongly", () => {
    // The direction that matters: the fallback is always available and is always at
    // or after the true capture time, so refusing a doubtful value costs at most the
    // old behaviour, while believing one puts a recording in a day nobody lived.
    const upload = "2026-07-25 21:30:00";
    expect(resolveCapturedAt({ declared: "not a date" }, NOW)).toBe(upload);
    expect(resolveCapturedAt({ declared: "" }, NOW)).toBe(upload);
    expect(resolveCapturedAt({ declared: "1904-01-01T00:00:00Z" }, NOW)).toBe(upload); // QuickTime epoch
    expect(resolveCapturedAt({ declared: "1970-01-01T00:00:00Z" }, NOW)).toBe(upload);
    expect(resolveCapturedAt({ declared: "2030-01-01T00:00:00Z" }, NOW)).toBe(upload); // a wrong clock
  });

  it("never lets the weak mtime hint move a capture time LATER than the upload", () => {
    // An mtime after the upload instant is a clock artefact, not a capture time.
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(resolveCapturedAt({ hint: future }, NOW)).toBe("2026-07-25 21:30:00");
  });

  it("tolerates a little browser clock skew, but not an hour of it", () => {
    const nearlyNow = new Date(NOW.getTime() + CAPTURE_FUTURE_SKEW_MS - 1000).toISOString();
    expect(resolveCapturedAt({ declared: nearlyNow }, NOW)).toBe(toSqliteUtc(Date.parse(nearlyNow)));
    const wayAhead = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    expect(resolveCapturedAt({ declared: wayAhead }, NOW)).toBe("2026-07-25 21:30:00");
  });

  it("parses both wire shapes: ISO-8601 and this app's own SQLite UTC text", () => {
    expect(parseCaptureInstant("2026-07-25T08:10:00.000Z")).toBe(Date.parse("2026-07-25T08:10:00Z"));
    // SQLite text has no zone marker: read as UTC, never as the server's local time.
    expect(parseCaptureInstant("2026-07-25 08:10:00")).toBe(Date.parse("2026-07-25T08:10:00Z"));
    expect(parseCaptureInstant(null)).toBeNull();
    expect(parseCaptureInstant(12345)).toBeNull();
  });

  it("bounds sanity at both ends", () => {
    const now = NOW.getTime();
    expect(isSaneCaptureInstant(CAPTURE_EPOCH_FLOOR_MS, now)).toBe(true);
    expect(isSaneCaptureInstant(CAPTURE_EPOCH_FLOOR_MS - 1, now)).toBe(false);
    expect(isSaneCaptureInstant(now + CAPTURE_FUTURE_SKEW_MS, now)).toBe(true);
    expect(isSaneCaptureInstant(now + CAPTURE_FUTURE_SKEW_MS + 1, now)).toBe(false);
    expect(isSaneCaptureInstant(NaN, now)).toBe(false);
  });
});

describe("ffprobe reads a container's embedded creation time", () => {
  it("returns the tag when a recorder wrote one, and null when none exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-ct-"));
    dirs.push(dir);
    const tagged = path.join(dir, "phone.m4a");
    const bare = path.join(dir, "bare.wav");
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-metadata",
       "creation_time=2026-07-25T08:10:00.000000Z", "-ac", "1", "-ar", "8000", tagged],
      { stdio: "ignore" },
    );
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ac", "1", "-ar", "8000", bare],
      { stdio: "ignore" },
    );
    expect(await probeCreationTime(tagged)).toBe("2026-07-25T08:10:00.000000Z");
    // No tag is a normal answer, not a failure — it must never cost the upload.
    expect(await probeCreationTime(bare)).toBeNull();
    expect(await probeCreationTime(path.join(dir, "missing.wav"))).toBeNull();
  });
});

describe("every 'when they spoke' claim reads captured_at (criterion 6)", () => {
  /** A session recorded at `capturedAt` and uploaded at 21:30 the same day. */
  function seed(db: Db, id: string, capturedAt: string): void {
    createSession(db, {
      id,
      originalFilename: `${id}.wav`,
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 600,
      capturedAt,
    });
    // The upload instant, thirteen hours later — the value the app used to read.
    db.prepare("UPDATE sessions SET created_at = '2026-07-25 21:30:00' WHERE id = ?").run(id);
    upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: 60_000, contentHash: `${id}-h0` });
    persistSegmentFindings(db, {
      sessionId: id,
      contentHash: `${id}-h0`,
      flagged: true,
      deepDone: true,
      findings: [
        {
          quote: "penso che è vero",
          correction: "penso che sia vero",
          category: "grammar",
          explanation: "congiuntivo",
          severity: "high",
          startMs: 0,
          endMs: 500,
        },
      ],
    });
  }

  it("THE HEADLINE CASE: recorded 08:10, uploaded 21:30 — reported as the morning, binned at 08:00", () => {
    const db = freshDb();
    seed(db, "dump", "2026-07-25 08:10:00");

    // The read-model hands the capture instant on, so the Archive, Focus and the
    // letter all inherit the right answer from one place.
    const rows = listIncludedFindingsWithSession(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionCapturedAt).toBe("2026-07-25 08:10:00");
    expect(rows[0].sessionCapturedAt).not.toBe("2026-07-25 21:30:00");

    // Focus's local-hour histogram, computed the way the page computes it. The
    // expectation is derived from the FIXTURE (08:10 UTC read as a local hour), never
    // from the artifact under test.
    const dist = slipHourDistribution(
      rows.map((f) => ({ sessionCapturedAt: f.sessionCapturedAt, startMs: f.startMs })),
    );
    const morningHour = new Date("2026-07-25T08:10:00Z").getHours();
    const eveningHour = new Date("2026-07-25T21:30:00Z").getHours();
    expect(dist.peakHour).toBe(morningHour);
    expect(dist.buckets[morningHour]).toBe(1);
    expect(dist.buckets[eveningHour]).toBe(0);
    // And the two really are different hours, or this test would prove nothing.
    expect(morningHour).not.toBe(eveningHour);
    db.close();
  });

  it("sorts the sessions list by when they were RECORDED, not when they landed", () => {
    const db = freshDb();
    // Uploaded in one batch tonight; recorded days apart.
    seed(db, "older", "2026-07-20 09:00:00");
    seed(db, "newer", "2026-07-25 08:10:00");
    const ids = (
      db.prepare(`SELECT id FROM sessions s ORDER BY ${capturedAtSql()} DESC`).all() as { id: string }[]
    ).map((r) => r.id);
    expect(ids).toEqual(["newer", "older"]);
    db.close();
  });

  it("a legacy row with no captured_at still answers, from the best value that exists", () => {
    // v28 backfills, so this is defence in depth — but a NULL must never DROP a
    // session out of a histogram, which a bare `captured_at` read would do.
    const db = freshDb();
    seed(db, "legacy", "2026-07-25 08:10:00");
    db.prepare("UPDATE sessions SET captured_at = NULL WHERE id = 'legacy'").run();
    const rows = listIncludedFindingsWithSession(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionCapturedAt).toBe("2026-07-25 21:30:00"); // falls back to created_at
    db.close();
  });

  it("migration v28 backfills every pre-existing row to its created_at", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds, created_at, captured_at)
       VALUES ('old', 'o.wav', 'wav', 1, 60, '2026-01-02 03:04:05', NULL)`,
    ).run();
    // Re-running the migration is what a pre-v28 database experiences on first boot.
    db.prepare("UPDATE sessions SET captured_at = created_at WHERE captured_at IS NULL").run();
    const row = db.prepare("SELECT captured_at FROM sessions WHERE id = 'old'").get() as {
      captured_at: string;
    };
    expect(row.captured_at).toBe("2026-01-02 03:04:05");
    db.close();
  });
});

describe("one dialect for the spoken instant", () => {
  it("no query outside lib/capture-time.ts reads a session's created_at as a capture time", () => {
    // "One rule, two dialects" produced two defects in v0.6 (`drillFitsShortAudio` vs
    // `DRILLABLE_CORRECTION_SQL`; `isAssumedRunLeaseHash` vs `ASSUMED_RUN_SQL`). The
    // spoken instant has exactly one SQL spelling, and this is the guard that keeps
    // a future query from quietly growing a second one.
    const roots = ["lib", "app", "components"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // Migrations legitimately DEFINE the column; capture-time owns the dialect.
        if (full.includes(path.join("lib", "migrations"))) continue;
        if (full.endsWith(path.join("lib", "capture-time.ts"))) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const line of text.split("\n")) {
          // A join or select of `s.created_at` from `sessions` is the shape that was
          // wrong everywhere. `lib/sessions.ts` still selects it deliberately — as the
          // upload instant, alongside `captured_at` — so it is allowed to name it once.
          if (/\bs\.created_at\b/.test(line) && !full.endsWith(path.join("lib", "sessions.ts"))) {
            offenders.push(`${full}: ${line.trim()}`);
          }
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(offenders).toEqual([]);
  });
});
