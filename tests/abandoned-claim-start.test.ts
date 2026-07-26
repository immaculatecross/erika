import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { ITEM_LESSON_CONTENT_VERSION } from "@/lib/lessons/item-lessons";
import type { SessionLessonBody } from "@/lib/session/lesson-body";

let dir: string;
let db: Db;
let GET_SESSION: typeof import("@/app/api/session/route").GET;
let POST_START: typeof import("@/app/api/session/start/route").POST;
let GET_LESSON: typeof import("@/app/api/session/lesson/route").GET;
let keyBefore: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-abandoned-claim-start-"));
  process.env.ERIKA_DATA_DIR = dir;
  process.env.ERIKA_DB_PATH = path.join(dir, "erika.db");
  keyBefore = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  db = (await import("@/lib/db")).getDb();
  GET_SESSION = (await import("@/app/api/session/route")).GET;
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

describe("an abandoned current claim cannot wall Start", () => {
  it("reports preparing but starts from complete authored Italian with zero spend", async () => {
    const initial = (await (await GET_SESSION()).json()) as {
      lesson: { itemId: string; kind: "grammar" | "vocab"; preparation: string };
    };
    expect(initial.lesson.itemId).toMatch(/^(rule|lemma):/);
    db.prepare(
      "INSERT INTO item_lessons (item_id, kind, register, body, content_version, claim_token) " +
        "VALUES (?, ?, 'colto', '', ?, 'abandoned-owner')",
    ).run(initial.lesson.itemId, initial.lesson.kind, ITEM_LESSON_CONTENT_VERSION);

    const preparing = (await (await GET_SESSION()).json()) as {
      lesson: { preparation: string };
    };
    expect(preparing.lesson.preparation).toBe("preparing");

    const started = await POST_START();
    expect(started.status).toBe(200);
    expect(((await started.json()) as { started: boolean }).started).toBe(true);

    const response = await GET_LESSON();
    expect(response.status).toBe(200);
    const body = (await response.json()) as SessionLessonBody;
    expect(body.lesson?.deterministic).toBe(true);
    expect(body.lesson?.exercises.length).toBeGreaterThanOrEqual(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 0 });
    const pinned = db.prepare("SELECT body, claim_token FROM item_lessons WHERE item_id = ?")
      .get(initial.lesson.itemId) as { body: string; claim_token: string | null };
    expect(pinned.body.length).toBeGreaterThan(0);
    expect(pinned.claim_token).toBeNull();
  });
});
