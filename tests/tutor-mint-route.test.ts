import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pageFileFor, tmpDir } from "./helpers";
import { noticeFor, TRANSIENT_WORDS } from "@/lib/session/notices";

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
/** What OpenAI answers the mint with. 200 unless a test is driving a refusal. */
let mintStatus = 200;
let mintBody = JSON.stringify({ value: EPHEMERAL, expires_at: 1_900_000_000 });

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
        return new Response(mintBody, {
          status: mintStatus,
          statusText: mintStatus === 401 ? "Unauthorized" : "OK",
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
  mintStatus = 200;
  mintBody = JSON.stringify({ value: EPHEMERAL, expires_at: 1_900_000_000 });
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

// ── [v0.7 close sweep] the route says WHICH failure it was ──────────────────────
//
// The v0.7 failure-path gate drove this route against a real OpenAI 401 and got
// "Erika could not reach the conversation service just now. Try again in a moment." —
// a standing condition (a rotated or revoked key) told as momentary, with no Settings
// link and an open invitation to retry forever. E-44 had already written the
// `key-rejected` notice; the tutor never adopted it. That is the v0.6 defect on the
// v0.7 flagship, and prose cannot hold it shut, so these are the assertions.
describe("POST /api/tutor/session — a permanent failure is named as permanent", () => {
  it("a key OpenAI REFUSED is key-rejected: standing, linked, never 'just now'", async () => {
    process.env.OPENAI_API_KEY = REAL_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
    mintStatus = 401;
    mintBody = JSON.stringify({ error: { message: "Incorrect API key provided." } });

    const res = await sessionPOST();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.notice).toBe("key-rejected");

    const notice = noticeFor(body.notice);
    expect(notice.standing).toBe(true);
    expect(notice.action?.href).toBe("/settings");
    for (const word of TRANSIENT_WORDS) expect(body.error.message.toLowerCase()).not.toContain(word);
    // Never "no key is set" to someone who has configured one.
    expect(body.error.message).toBe(notice.body);
    expect(body.error.message).not.toBe(noticeFor("no-key").body);
    // And the refusal is still free: no token minted, no reservation left behind.
    expect(body.clientSecret).toBeUndefined();
    const pending = getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number };
    expect(pending.n).toBe(0);
  });

  it("no key at all is no-key, with its own remedy", async () => {
    delete process.env.OPENAI_API_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
    const res = await sessionPOST();
    const body = await res.json();
    expect(body.notice).toBe("no-key");
    expect(noticeFor("no-key").action?.href).toBe("/settings");
    process.env.OPENAI_API_KEY = REAL_KEY;
  });

  it("a genuinely momentary failure is the only one that may say 'just now' — and it retries", async () => {
    process.env.OPENAI_API_KEY = REAL_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
    mintStatus = 503;
    mintBody = JSON.stringify({ error: { message: "Service Unavailable" } });
    const res = await sessionPOST();
    const body = await res.json();
    expect(body.notice).toBe("conversation-transient");
    expect(noticeFor(body.notice).standing).toBe(false);
    expect(noticeFor(body.notice).retryable).toBe(true);
  });

  // The cap: the gate found TRUE copy with zero controls. True is not enough.
  it("the cap carries a way forward — a link that resolves, and no retry that cannot help", async () => {
    process.env.OPENAI_API_KEY = REAL_KEY;
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const res = await sessionPOST();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.notice).toBe("budget");

    const notice = noticeFor("budget");
    expect(notice.action?.href).toBe("/settings");
    expect(fs.existsSync(pageFileFor("/settings"))).toBe(true);
    expect(notice.retryable).toBe(false);
    // The true sentence the gate confirmed is still there, unchanged.
    expect(body.error.message).toContain("No conversation was started.");
    writeSettings(getDb(), { monthlyBudgetUsd: 100 });
  });
});
