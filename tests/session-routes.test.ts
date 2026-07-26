import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The session's API surface, driven through the REAL route modules against a
// disposable database (the `honest-home-routes` pattern). Route handlers are where
// the criterion-3 degradations actually resolve, and a unit test of the planner does
// not prove the wire.
//
// No model call is ever made here: the lesson route's two standing pre-checks (no key,
// no budget) answer before any network work, which is precisely why they exist.

let dir: string;
let GET_SESSION: typeof import("@/app/api/session/route").GET;
let POST_START: typeof import("@/app/api/session/start/route").POST;
let POST_STEP: typeof import("@/app/api/session/step/route").POST;
let POST_LESSON: typeof import("@/app/api/session/lesson/route").POST;
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
  POST_LESSON = (await import("@/app/api/session/lesson/route")).POST;
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

describe("POST /api/session/lesson — the keyless degradation (criterion 3)", () => {
  it("returns the syllabus's OWN lesson, and names the missing key", async () => {
    const body = (await (await POST_LESSON()).json()) as {
      lesson: unknown;
      fallback: { title: string; description: string; examples: string[] } | null;
      notice: string | null;
    };
    // No exercises could be written — but there IS a lesson, and it is a real one.
    expect(body.lesson).toBeNull();
    expect(body.notice).toBe("no-key");
    expect(body.fallback).not.toBeNull();
    expect(body.fallback!.description.length).toBeGreaterThan(40);
    expect(body.fallback!.examples.length).toBeGreaterThan(0);
  });
});

describe("POST /api/session/start then /step — linear, resumable, authoritative", () => {
  it("opens the session idempotently", async () => {
    const first = (await (await POST_START()).json()) as SessionBody;
    const second = (await (await POST_START()).json()) as SessionBody;
    expect(first.started).toBe(true);
    expect(second.steps).toEqual(first.steps);
    expect(second.doneSteps).toEqual(first.doneSteps);
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
  });
});
