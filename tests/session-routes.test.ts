import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillCard } from "@/components/drill-card";
import { LessonStep } from "@/components/session/lesson-step";
import { assertItalianLesson, validateItalianText } from "@/lib/lessons/italian-language";
import type { SessionLessonBody } from "@/lib/session/lesson-body";

// The session's API surface, driven through the REAL route modules against a
// disposable database (the `honest-home-routes` pattern). Route handlers are where
// the criterion-3 degradations actually resolve, and a unit test of the planner does
// not prove the wire.
//
// No model call is ever made here: preparation resolves the authored path first, and
// every later Start/open/reopen/step operation only reads that completed cache body.

let dir: string;
let GET_SESSION: typeof import("@/app/api/session/route").GET;
let POST_START: typeof import("@/app/api/session/start/route").POST;
let POST_STEP: typeof import("@/app/api/session/step/route").POST;
let POST_PREPARE: typeof import("@/app/api/session/prepare/route").POST;
let GET_LESSON: typeof import("@/app/api/session/lesson/route").GET;
let GET_TODAY: typeof import("@/app/api/learn/today/route").GET;
let keyBefore: string | undefined;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-session-routes-"));
  process.env.ERIKA_DATA_DIR = dir;
  process.env.ERIKA_DB_PATH = path.join(dir, "erika.db");
  keyBefore = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // the keyless walk: nothing may call a model

  GET_SESSION = (await import("@/app/api/session/route")).GET;
  POST_START = (await import("@/app/api/session/start/route")).POST;
  POST_STEP = (await import("@/app/api/session/step/route")).POST;
  POST_PREPARE = (await import("@/app/api/session/prepare/route")).POST;
  GET_LESSON = (await import("@/app/api/session/lesson/route")).GET;
  GET_TODAY = (await import("@/app/api/learn/today/route")).GET;
});

afterAll(() => {
  if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = keyBefore;
  delete process.env.ERIKA_DATA_DIR;
  delete process.env.ERIKA_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

type SessionBody = {
  started: boolean;
  steps: string[];
  doneSteps: string[];
  step: string | null;
  complete: boolean;
  summary: string;
  lesson: { itemId: string; label: string | null; kind: string } | null;
};

describe("GET /api/session — the day before it is started", () => {
  it("previews a real day and has not opened one", async () => {
    const body = (await (await GET_SESSION()).json()) as SessionBody;
    expect(body.started).toBe(false);
    expect(body.steps).toContain("lesson");
    expect(body.summary).toContain("A lesson on");
    expect(body.step).toBe("lesson");
  });
});

describe("one-lesson-ahead — the keyless route boundary", () => {
  it("starts immediately when authored Italian is servable, then may cache it ahead", async () => {
    const directlyServed = await GET_LESSON();
    expect(directlyServed.status).toBe(200);
    const started = await POST_START();
    expect(started.status).toBe(200);
    expect(((await started.json()) as SessionBody).started).toBe(true);
    expect((await import("@/lib/db")).getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 0 });

    const prepared = await POST_PREPARE();
    expect(prepared.status).toBe(200);
    const prepBody = (await prepared.json()) as { state: string; source: string; selectedItemId: string; servedItemId: string };
    expect(prepBody.state).toBe("ready");
    expect(prepBody.source).toBe("authored");
    expect(prepBody.selectedItemId).toMatch(/^(lemma|rule):/);
    expect(prepBody.servedItemId).toMatch(/^rule:/);

    const body = (await (await GET_LESSON()).json()) as SessionLessonBody;
    expect(body.lesson).not.toBeNull();
    expect(body.lesson!.intro.length).toBeGreaterThan(40);
    expect(body.lesson!.exercises.length).toBeGreaterThanOrEqual(2);
    expect(body.notice).toBeNull();
    expect(body.fallback).not.toBeNull();
    expect(body.fallback!.description.length).toBeGreaterThan(40);
    expect(body.fallback!.examples.length).toBeGreaterThan(0);

    // The same product boundary reaches the rendered teaching surfaces. Every field
    // is checked in Italian, then the lesson and first drill are proved present in
    // their actual components rather than only in helper output.
    assertItalianLesson(body.lesson!);
    expect(validateItalianText(body.fallback!.title).valid).toBe(true);
    expect(validateItalianText(body.fallback!.description).valid).toBe(true);
    const lessonHtml = renderToStaticMarkup(
      createElement(LessonStep, { data: body, onRetry: () => {}, onDone: () => {} }),
    );
    expect(lessonHtml).toContain(body.fallback!.title);
    expect(lessonHtml).toContain(body.lesson!.intro);
    const drill = body.lesson!.exercises[0];
    const drillHtml = renderToStaticMarkup(
      createElement(DrillCard, { exercise: drill, speechOffered: true, onResolve: () => {} }),
    );
    expect(drillHtml).toContain(drill.prompt);
    for (const option of drill.options) expect(drillHtml).toContain(option);

    // Opening and reopening are read-only with respect to generation and spend.
    await GET_LESSON();
    expect((await import("@/lib/db")).getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 0 });
  });
});

describe("POST /api/session/start then /step — linear, resumable, authoritative", () => {
  it("opens the session idempotently", async () => {
    const first = (await (await POST_START()).json()) as SessionBody;
    const second = (await (await POST_START()).json()) as SessionBody;
    expect(first.started).toBe(true);
    expect(second.steps).toEqual(first.steps);
    expect(second.doneSteps).toEqual(first.doneSteps);
    expect((await import("@/lib/db")).getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 0 });
  });

  it("refuses a step that is not a step", async () => {
    const res = await POST_STEP(
      new Request("http://localhost/api/session/step", {
        method: "POST",
        body: JSON.stringify({ step: "quiz" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_step");
  });

  it("advances one step at a time and completes the DAY with the session", async () => {
    const view = (await (await GET_SESSION()).json()) as SessionBody;
    let last: SessionBody = view;
    for (const step of view.steps) {
      const res = await POST_STEP(
        new Request("http://localhost/api/session/step", {
          method: "POST",
          body: JSON.stringify({ step }),
        }),
      );
      expect(res.status).toBe(200);
      last = (await res.json()) as SessionBody;
    }
    expect(last.complete).toBe(true);
    expect(last.step).toBeNull();

    // And the Learn home now reads as a finished day, with no control at all.
    const today = (await (await GET_TODAY()).json()) as {
      complete: boolean;
      action: { kind: string };
      completion: { lessonsDone: number } | null;
      goal: { done: number; total: number };
    };
    expect(today.complete).toBe(true);
    expect(today.action.kind).toBe("none");
    expect(today.completion?.lessonsDone).toBe(1);
    expect(today.goal.done).toBe(today.goal.total);
    expect((await import("@/lib/db")).getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 0 });
  });
});
