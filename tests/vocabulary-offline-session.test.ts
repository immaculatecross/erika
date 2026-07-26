import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";

// The product boundary for E-47 criterion 8: the shipped settings can compose a
// vocabulary-only day, and the real planner/prepare/start routes must turn it into
// authored grammar when no model is reachable.

let dir: string;
let db: Db;
let GET_SESSION: typeof import("@/app/api/session/route").GET;
let POST_PREPARE: typeof import("@/app/api/session/prepare/route").POST;
let GET_LESSON: typeof import("@/app/api/session/lesson/route").GET;
let POST_START: typeof import("@/app/api/session/start/route").POST;
let keyBefore: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-vocab-offline-"));
  process.env.ERIKA_DATA_DIR = dir;
  process.env.ERIKA_DB_PATH = path.join(dir, "erika.db");
  keyBefore = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const database = await import("@/lib/db");
  const settings = await import("@/lib/settings");
  db = database.getDb();
  settings.writeSettings(db, {
    newVocabPerDay: 1,
    newRulesPerDay: 0,
    newPronPerDay: 0,
  });
  GET_SESSION = (await import("@/app/api/session/route")).GET;
  POST_PREPARE = (await import("@/app/api/session/prepare/route")).POST;
  GET_LESSON = (await import("@/app/api/session/lesson/route")).GET;
  POST_START = (await import("@/app/api/session/start/route")).POST;
});

afterAll(() => {
  if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = keyBefore;
  delete process.env.ERIKA_DATA_DIR;
  delete process.env.ERIKA_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("vocabulary-only day without a reachable model", () => {
  it("plans the lemma and launches its authored grammar substitution", async () => {
    const preview = (await (await GET_SESSION()).json()) as {
      lesson: { itemId: string; preparation: string } | null;
      steps: string[];
    };
    expect(preview.lesson?.itemId).toMatch(/^lemma:/);
    expect(preview.lesson?.preparation).toBe("needed");
    expect(preview.steps).toEqual(expect.arrayContaining(["lesson", "drills"]));

    const prepared = await POST_PREPARE();
    expect(prepared.status).toBe(200);
    const preparation = (await prepared.json()) as {
      source: string;
      selectedItemId: string;
      servedItemId: string;
    };
    expect(preparation.source).toBe("authored");
    expect(preparation.selectedItemId).toMatch(/^lemma:/);
    expect(preparation.servedItemId).toMatch(/^rule:/);

    const lesson = (await (await GET_LESSON()).json()) as {
      itemId: string;
      lesson: { itemId: string; deterministic?: boolean };
    };
    expect(lesson.itemId).toBe(preparation.selectedItemId);
    expect(lesson.lesson.itemId).toBe(preparation.servedItemId);
    expect(lesson.lesson.deterministic).toBe(true);

    const started = await POST_START();
    expect(started.status).toBe(200);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get(),
    ).toEqual({ n: 0 });
  });
});
