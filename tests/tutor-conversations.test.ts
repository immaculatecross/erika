import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { writeSettings } from "@/lib/settings";
import { localDay } from "@/lib/local-day";
import {
  closeAbandonedConversations,
  closeConversation,
  conversationsForDay,
  getConversation,
  linkRecordingByCaptureTime,
  metMinimumOnDay,
  openConversation,
  serverElapsedSeconds,
  tutorMinimumSeconds,
} from "@/lib/tutor/conversations";
import { maxTutorSessionSeconds } from "@/lib/tutor/money";

// Migration v29 and the contract WO-E44 consumes (E-43 criteria 6, 7).
//
// The load-bearing claims, each of which is a decision someone could quietly undo:
//   * duration is SERVER-measured, and a client may only ever LOWER it;
//   * the minimum is copied in at OPEN, so changing the setting never rewrites a
//     recorded day;
//   * closing is idempotent, so a retry or a pagehide beacon cannot double-credit;
//   * a conversation below the minimum is REAL and is never treated as a failure;
//   * an abandoned conversation is recorded as unknown, never guessed favourably.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-conv-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Backdate a conversation's start so the server's own elapsed clock is exercised. */
function startedSecondsAgo(db: Db, id: string, seconds: number): void {
  db.prepare("UPDATE tutor_conversations SET started_at = datetime('now', ?) WHERE id = ?").run(
    `-${Math.round(seconds)} seconds`,
    id,
  );
}

describe("the minimum comes from Settings and is copied in at open", () => {
  it("defaults to five minutes", () => {
    const db = freshDb();
    expect(tutorMinimumSeconds(db)).toBe(300);
    db.close();
  });

  it("a later change to the setting never rewrites a conversation already recorded", () => {
    const db = freshDb();
    openConversation(db, "c1", tutorMinimumSeconds(db)); // 300 s
    startedSecondsAgo(db, "c1", 360);
    closeConversation(db, "c1", { clientSeconds: 360 });
    expect(getConversation(db, "c1")?.metMinimum).toBe(true);

    writeSettings(db, { tutorMinMinutes: 20 });
    expect(tutorMinimumSeconds(db)).toBe(1200);
    // The recorded day is untouched: history is never rewritten (the E-38 rule).
    expect(getConversation(db, "c1")?.minSeconds).toBe(300);
    expect(getConversation(db, "c1")?.metMinimum).toBe(true);
    db.close();
  });
});

describe("duration is server-measured and the client may only lower it", () => {
  it("uses the server's elapsed time when the client reports nothing", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 400);
    const closed = closeConversation(db, "c", {});
    expect(closed?.durationSeconds).toBeGreaterThanOrEqual(399);
    expect(closed?.metMinimum).toBe(true);
    db.close();
  });

  it("takes a SMALLER client figure — the honest half of a conversation", () => {
    // The server's elapsed includes connecting and idling; the client knows how much
    // of it was really a conversation, and under-crediting yourself harms nobody.
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 600);
    const closed = closeConversation(db, "c", { clientSeconds: 120 });
    expect(closed?.durationSeconds).toBe(120);
    expect(closed?.metMinimum).toBe(false);
    db.close();
  });

  it("REFUSES a larger client figure — a client can never inflate its way to a credit", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 30);
    const closed = closeConversation(db, "c", { clientSeconds: 99_999 });
    expect(closed?.durationSeconds).toBeLessThanOrEqual(35);
    expect(closed?.metMinimum).toBe(false);
    expect(metMinimumOnDay(db, localDay())).toBe(false);
    db.close();
  });

  it("ignores a nonsensical client figure and falls back to the server's", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 400);
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const probe = freshDb();
      openConversation(probe, "c", 300);
      startedSecondsAgo(probe, "c", 400);
      const closed = closeConversation(probe, "c", { clientSeconds: bad });
      expect(closed?.durationSeconds).toBeGreaterThanOrEqual(399);
      probe.close();
    }
    db.close();
  });

  it("reports the server's own elapsed seconds independently of any client", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 90);
    expect(serverElapsedSeconds(db, "c")).toBeGreaterThanOrEqual(89);
    expect(serverElapsedSeconds(db, "missing")).toBeNull();
    db.close();
  });
});

describe("closing is idempotent", () => {
  it("a second close — a retry, or the pagehide beacon racing the button — changes nothing", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 400);
    const first = closeConversation(db, "c", { clientSeconds: 380 });
    const second = closeConversation(db, "c", { clientSeconds: 10 });
    expect(second?.durationSeconds).toBe(first?.durationSeconds);
    expect(second?.metMinimum).toBe(first?.metMinimum);
    expect(conversationsForDay(db, localDay())).toHaveLength(1);
    db.close();
  });

  it("closing an id that does not exist is a null, not a phantom row", () => {
    const db = freshDb();
    expect(closeConversation(db, "nope", {})).toBeNull();
    expect(conversationsForDay(db, localDay())).toHaveLength(0);
    db.close();
  });
});

describe("a conversation below the minimum is real, it simply has not met the bar", () => {
  it("is recorded, is readable for the day, and does not credit it", () => {
    const db = freshDb();
    openConversation(db, "short", 300);
    startedSecondsAgo(db, "short", 100);
    closeConversation(db, "short", { clientSeconds: 100 });
    const day = conversationsForDay(db, localDay());
    expect(day).toHaveLength(1);
    expect(day[0].durationSeconds).toBe(100);
    expect(day[0].metMinimum).toBe(false);
    expect(metMinimumOnDay(db, localDay())).toBe(false);
    db.close();
  });

  it("one qualifying conversation credits the day even beside a short one", () => {
    const db = freshDb();
    openConversation(db, "short", 300);
    startedSecondsAgo(db, "short", 60);
    closeConversation(db, "short", { clientSeconds: 60 });
    openConversation(db, "long", 300);
    startedSecondsAgo(db, "long", 400);
    closeConversation(db, "long", { clientSeconds: 400 });
    expect(metMinimumOnDay(db, localDay())).toBe(true);
    expect(conversationsForDay(db, localDay())).toHaveLength(2);
    db.close();
  });

  it("a minimum of zero counts every conversation", () => {
    const db = freshDb();
    writeSettings(db, { tutorMinMinutes: 0 });
    openConversation(db, "c", tutorMinimumSeconds(db));
    closeConversation(db, "c", { clientSeconds: 1 });
    expect(metMinimumOnDay(db, localDay())).toBe(true);
    db.close();
  });
});

describe("an abandoned conversation is recorded as unknown, never guessed favourably", () => {
  it("closes with a NULL duration and no credit", () => {
    const db = freshDb();
    openConversation(db, "gone", 300);
    startedSecondsAgo(db, "gone", maxTutorSessionSeconds() + 600);
    expect(closeAbandonedConversations(db)).toBe(1);
    const conv = getConversation(db, "gone");
    expect(conv?.endedAt).not.toBeNull();
    expect(conv?.durationSeconds).toBeNull();
    expect(conv?.metMinimum).toBe(false);
    expect(metMinimumOnDay(db, localDay())).toBe(false);
    db.close();
  });

  it("leaves a conversation that could still be live alone", () => {
    const db = freshDb();
    openConversation(db, "live", 300);
    startedSecondsAgo(db, "live", 120);
    expect(closeAbandonedConversations(db)).toBe(0);
    expect(getConversation(db, "live")?.endedAt).toBeNull();
    db.close();
  });

  it("an OPEN conversation is invisible to the day's reader", () => {
    const db = freshDb();
    openConversation(db, "live", 300);
    expect(conversationsForDay(db, localDay())).toHaveLength(0);
    expect(metMinimumOnDay(db, localDay())).toBe(false);
    db.close();
  });
});

describe("the recording is linked by capture time", () => {
  function insertSession(db: Db, id: string, capturedAtSql: string): void {
    db.prepare(
      "INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds, captured_at) " +
        `VALUES (?, ?, 'webm', 100, 10, ${capturedAtSql})`,
    ).run(id, `${id}.webm`);
  }

  it("claims the session captured inside the conversation's window", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 400);
    insertSession(db, "s-inside", "datetime('now', '-390 seconds')");
    closeConversation(db, "c", { clientSeconds: 400 });
    expect(linkRecordingByCaptureTime(db, "c")).toBe("s-inside");
    expect(getConversation(db, "c")?.sessionId).toBe("s-inside");
    db.close();
  });

  it("leaves the link NULL when nothing was captured in the window", () => {
    // "when one exists" (criterion 7) means exactly this: no guess, no nearest match.
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 400);
    insertSession(db, "s-old", "datetime('now', '-9000 seconds')");
    closeConversation(db, "c", { clientSeconds: 400 });
    expect(linkRecordingByCaptureTime(db, "c")).toBeNull();
    expect(getConversation(db, "c")?.sessionId).toBeNull();
    db.close();
  });

  it("never steals a recording another conversation already claimed", () => {
    const db = freshDb();
    openConversation(db, "first", 300);
    startedSecondsAgo(db, "first", 400);
    insertSession(db, "s1", "datetime('now', '-390 seconds')");
    closeConversation(db, "first", { clientSeconds: 400 });
    expect(linkRecordingByCaptureTime(db, "first")).toBe("s1");

    openConversation(db, "second", 300);
    startedSecondsAgo(db, "second", 395);
    closeConversation(db, "second", { clientSeconds: 300 });
    expect(linkRecordingByCaptureTime(db, "second")).toBeNull();
    db.close();
  });

  it("deleting the recording keeps the fact that the conversation happened", () => {
    const db = freshDb();
    openConversation(db, "c", 300);
    startedSecondsAgo(db, "c", 400);
    insertSession(db, "s1", "datetime('now', '-390 seconds')");
    closeConversation(db, "c", { clientSeconds: 400 });
    linkRecordingByCaptureTime(db, "c");
    db.prepare("DELETE FROM sessions WHERE id = 's1'").run();
    const conv = getConversation(db, "c");
    expect(conv).not.toBeNull();
    expect(conv?.sessionId).toBeNull();
    expect(conv?.metMinimum).toBe(true);
    expect(metMinimumOnDay(db, localDay())).toBe(true);
    db.close();
  });
});
