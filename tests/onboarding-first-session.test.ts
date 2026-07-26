import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { FIRST_SESSION_PATH } from "@/lib/onboarding/routing";
import type { SessionLessonBody } from "@/lib/session/lesson-body";

let dir: string;
let db: Db;
let POST_ONBOARDING: typeof import("@/app/api/onboarding/route").POST;
let POST_START: typeof import("@/app/api/session/start/route").POST;
let GET_LESSON: typeof import("@/app/api/session/lesson/route").GET;
let keyBefore: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-onboarding-first-session-"));
  process.env.ERIKA_DATA_DIR = dir;
  process.env.ERIKA_DB_PATH = path.join(dir, "erika.db");
  keyBefore = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  db = (await import("@/lib/db")).getDb();
  POST_ONBOARDING = (await import("@/app/api/onboarding/route")).POST;
  POST_START = (await import("@/app/api/session/start/route")).POST;
  GET_LESSON = (await import("@/app/api/session/lesson/route")).GET;
});

afterAll(() => {
  if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = keyBefore;
  delete process.env.ERIKA_DATA_DIR;
  delete process.env.ERIKA_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("onboarding directly enters the first session", () => {
  it("starts and serves authored Italian without preparation spend", async () => {
    expect(FIRST_SESSION_PATH).toBe("/practice/session");
    expect((await POST_ONBOARDING()).status).toBe(200);

    const started = await POST_START();
    expect(started.status).toBe(200);
    expect(((await started.json()) as { started: boolean }).started).toBe(true);

    const response = await GET_LESSON();
    expect(response.status).toBe(200);
    const body = (await response.json()) as SessionLessonBody;
    expect(body.lesson?.deterministic).toBe(true);
    expect(body.lesson?.intro.length).toBeGreaterThan(40);
    expect(db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM item_lessons").get()).toEqual({ n: 0 });
  });
});
