import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";

// The ephemeral-mint route (E-34, WO criterion 1) — the secret-exposure boundary,
// never-waivable. The real OPENAI_API_KEY is used ONLY server-side to mint a
// short-lived ephemeral client secret; the browser receives ONLY that ephemeral
// value. These tests drive the REAL route through the REAL minter with global fetch
// mocked (no network, no real key), and prove: the key is sent to OpenAI server-side
// but NEVER appears in the client response; the cap refuses truthfully with no token
// minted; and with no server key the route refuses and mints nothing.

// A fake stand-in for the server key. Deliberately NOT key-shaped (no provider
// prefix) so the source-scanning hook stays green; its only job is to be a unique
// string we can prove never appears in the client response.
const REAL_KEY = "FAKE-server-key-must-never-leak-to-the-browser";
const EPHEMERAL = "ek_ephemeral_test_value";

let root: string;
let sessionPOST: typeof import("@/app/api/tutor/session/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let writeSettings: typeof import("@/lib/settings").writeSettings;

let lastAuth: string | null = null;
let mintCalls = 0;

beforeAll(async () => {
  root = tmpDir("erika-tutor-mint-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  process.env.OPENAI_API_KEY = REAL_KEY;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/v1/realtime/client_secrets")) {
        mintCalls += 1;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        lastAuth = headers.authorization ?? headers.Authorization ?? null;
        return new Response(JSON.stringify({ value: EPHEMERAL, expires_at: 1_900_000_000 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected fetch", { status: 500 });
    }),
  );

  sessionPOST = (await import("@/app/api/tutor/session/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  writeSettings = (await import("@/lib/settings")).writeSettings;
});

afterEach(() => {
  getDb().prepare("DELETE FROM spend_ledger").run();
  lastAuth = null;
});
afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /api/tutor/session — the key never reaches the browser", () => {
  it("mints server-side and returns ONLY the ephemeral secret", async () => {
    process.env.OPENAI_API_KEY = REAL_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
    const res = await sessionPOST();
    expect(res.status).toBe(200);
    const body = await res.json();

    // The browser gets the ephemeral secret and the session config — never the key.
    expect(body.clientSecret).toBe(EPHEMERAL);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(REAL_KEY);
    expect(serialized).not.toContain("OPENAI_API_KEY");

    // The real key WAS used server-side to authorize the mint.
    expect(lastAuth).toBe(`Bearer ${REAL_KEY}`);
    // The session config the browser applies carries instructions/tools but no key.
    expect(body.session.tools.some((t: { name: string }) => t.name === "log_evidence")).toBe(true);
    expect(JSON.stringify(body.session)).not.toContain(REAL_KEY);
  });
});

describe("POST /api/tutor/session — truthful cap refusal (never-waivable spend)", () => {
  it("refuses at the cap with 402, no token minted, no lease left", async () => {
    process.env.OPENAI_API_KEY = REAL_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const before = mintCalls;
    const res = await sessionPOST();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("budget");
    expect(body.clientSecret).toBeUndefined();
    expect(mintCalls).toBe(before); // the minter was never called
    const pending = getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number };
    expect(pending.n).toBe(0);
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
  });
});

describe("POST /api/tutor/session — requires the server principal's key", () => {
  it("refuses (503) and mints nothing when OPENAI_API_KEY is absent", async () => {
    delete process.env.OPENAI_API_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
    const res = await sessionPOST();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.clientSecret).toBeUndefined();
    // The lease opened then released on the mint failure — no pending row lingers.
    const pending = getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number };
    expect(pending.n).toBe(0);
    process.env.OPENAI_API_KEY = REAL_KEY;
  });
});
