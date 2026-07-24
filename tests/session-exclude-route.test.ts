import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// E-36 criterion 6: the session-exclusion API (the manual "this recording isn't me").
// POST { excluded } flips sessions.exclude_from_evidence and returns the session; a
// bad body is refused, a missing session 404s. Real DB under a throwaway dir.

let root: string;
let POST: typeof import("@/app/api/sessions/[id]/exclude/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let getSession: typeof import("@/lib/sessions").getSession;

beforeAll(async () => {
  root = tmpDir("erika-exclude-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  POST = (await import("@/app/api/sessions/[id]/exclude/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  getSession = (await import("@/lib/sessions")).getSession;
});
afterEach(() => getDb().prepare("DELETE FROM sessions").run());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  POST(new Request("http://t/x", { method: "POST", body: JSON.stringify(body) }), ctx(id));

function seed(id: string): void {
  createSession(getDb(), { id, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
}

describe("POST /api/sessions/[id]/exclude", () => {
  it("sets and clears the exclusion flag, returning the updated session", async () => {
    seed("s1");
    expect(getSession(getDb(), "s1")!.excludeFromEvidence).toBe(false);

    const on = await post("s1", { excluded: true });
    expect(on.status).toBe(200);
    expect((await on.json()).excludeFromEvidence).toBe(true);
    expect(getSession(getDb(), "s1")!.excludeFromEvidence).toBe(true);

    const off = await post("s1", { excluded: false });
    expect((await off.json()).excludeFromEvidence).toBe(false);
    expect(getSession(getDb(), "s1")!.excludeFromEvidence).toBe(false);
  });

  it("refuses a non-boolean body (400) and a missing session (404)", async () => {
    seed("s2");
    expect((await post("s2", { excluded: "yes" })).status).toBe(400);
    expect((await post("nope", { excluded: true })).status).toBe(404);
  });
});
