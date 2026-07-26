import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { prepareItemLesson } from "@/lib/lessons/item-lessons";
import type { TextCompletion, TextModelClient } from "@/lib/lessons/text-model";
import type { SessionLessonBody } from "@/lib/session/lesson-body";

const GENERATED_VOCAB = JSON.stringify({
  intro: "La parola indica un elemento preciso e viene usata in una frase italiana completa.",
  definition: "Elemento definito dal contesto della frase.",
  examples: ["Uso questa parola in una frase corretta."],
  newWords: [
    {
      lemma: "elemento",
      definition: "Parte riconoscibile di un insieme più grande.",
      example: "Ogni elemento ha una funzione precisa.",
    },
  ],
  exercises: [
    {
      type: "choice",
      prompt: "Quale parola completa correttamente la frase?",
      options: ["elemento", "elementi"],
      answerIndex: 0,
      answer: "elemento",
      invite: "click",
      rationale: "Il nome singolare concorda con il resto della frase.",
    },
    {
      type: "choice",
      prompt: "Ogni ____ ha una funzione precisa.",
      options: ["elemento", "elementi"],
      answerIndex: 0,
      answer: "elemento",
      invite: "speak",
      rationale: "Ogni richiede qui un nome al singolare.",
    },
  ],
});

let dir: string;
let db: Db;
let GET_SESSION: typeof import("@/app/api/session/route").GET;
let POST_START: typeof import("@/app/api/session/start/route").POST;
let GET_LESSON: typeof import("@/app/api/session/lesson/route").GET;
let POST_COMPLETE: typeof import("@/app/api/lessons/item/complete/route").POST;
let keyBefore: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-active-claim-stability-"));
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
  POST_START = (await import("@/app/api/session/start/route")).POST;
  GET_LESSON = (await import("@/app/api/session/lesson/route")).GET;
  POST_COMPLETE = (await import("@/app/api/lessons/item/complete/route")).POST;
});

afterAll(() => {
  if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = keyBefore;
  delete process.env.ERIKA_DATA_DIR;
  delete process.env.ERIKA_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("an active preparation cannot change an open daily session", () => {
  it("pins authored rule content while the accepted owner resolves and is billed once", async () => {
    const preview = (await (await GET_SESSION()).json()) as {
      lesson: { itemId: string; preparation: string };
    };
    expect(preview.lesson.itemId).toMatch(/^lemma:/);

    let calls = 0;
    let resolveOwner!: (completion: TextCompletion) => void;
    const client: TextModelClient = {
      complete() {
        calls++;
        return new Promise<TextCompletion>((resolve) => {
          resolveOwner = resolve;
        });
      },
    };
    const active = prepareItemLesson(db, client, preview.lesson.itemId);
    expect(calls).toBe(1);
    expect(
      db.prepare("SELECT body FROM item_lessons WHERE item_id = ?").get(preview.lesson.itemId),
    ).toEqual({ body: "" });

    const started = await POST_START();
    expect(started.status).toBe(200);

    // Ordering proof: Start must freeze the empty claim before the live owner
    // resolves. Removing the pin write (or its `body = ''` guard) lets the late
    // generated vocabulary body replace this authored rule and fails below.
    const pinnedBeforeOwner = db
      .prepare("SELECT body, claim_token FROM item_lessons WHERE item_id = ?")
      .get(preview.lesson.itemId) as { body: string; claim_token: string | null };
    expect(pinnedBeforeOwner.body.length).toBeGreaterThan(0);
    expect(pinnedBeforeOwner.claim_token).toBeNull();
    expect((JSON.parse(pinnedBeforeOwner.body) as { itemId: string; deterministic?: boolean }).itemId)
      .toMatch(/^rule:/);
    expect((JSON.parse(pinnedBeforeOwner.body) as { deterministic?: boolean }).deterministic)
      .toBe(true);

    const firstResponse = await GET_LESSON();
    const firstBytes = await firstResponse.text();
    const first = JSON.parse(firstBytes) as SessionLessonBody;
    expect(first.lesson?.itemId).toMatch(/^rule:/);
    expect(first.lesson?.deterministic).toBe(true);
    const servedItemId = first.lesson!.itemId;
    const drills = first.lesson!.exercises;

    resolveOwner({
      text: GENERATED_VOCAB,
      promptTokens: 150,
      completionTokens: 320,
    });
    const ownerResult = await active;
    expect(ownerResult.lesson?.itemId).toBe(servedItemId);
    expect(ownerResult.lesson?.deterministic).toBe(true);

    const secondResponse = await GET_LESSON();
    const secondBytes = await secondResponse.text();
    const second = JSON.parse(secondBytes) as SessionLessonBody;
    expect(secondBytes).toBe(firstBytes);
    expect(second.lesson?.itemId).toBe(servedItemId);
    expect(second.lesson?.exercises).toEqual(drills);

    const evidence = await POST_COMPLETE(
      new Request("http://localhost/api/lessons/item/complete", {
        method: "POST",
        body: JSON.stringify({ itemId: second.lesson!.itemId, correct: true }),
      }),
    );
    expect(evidence.status).toBe(200);
    expect((await evidence.json()) as { itemId: string }).toMatchObject({
      itemId: servedItemId,
    });
    expect(
      db.prepare("SELECT item_id, mode FROM evidence ORDER BY id DESC LIMIT 1").get(),
    ).toEqual({ item_id: servedItemId, mode: "cued" });

    const spend = db.prepare("SELECT state, COUNT(*) AS n FROM spend_ledger GROUP BY state")
      .all() as { state: string; n: number }[];
    expect(spend).toEqual([{ state: "committed", n: 1 }]);
    expect(calls).toBe(1);
    const pinned = db.prepare("SELECT body FROM item_lessons WHERE item_id = ?")
      .get(preview.lesson.itemId) as { body: string };
    expect((JSON.parse(pinned.body) as { itemId: string }).itemId).toBe(servedItemId);
  });
});
