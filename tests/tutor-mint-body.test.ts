import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { buildTutorSessionConfig } from "@/lib/tutor/session-config";
import {
  MINT_SESSION_WIRE_FIELDS,
  buildMintSessionWireBody,
  openAiClientSecretMinter,
} from "@/lib/tutor/mint";

// Contract-pin on the mint WIRE BODY (OBS-001, suspect #1). The client-secret mint
// used to serialize the whole internal session config, so `maxSessionSeconds` — a
// server-side length ceiling OpenAI has NO field for — rode onto the wire and the
// endpoint 400'd on the unknown param, 503-ing the tutor route ("the API responded,
// but there was an error"). These tests pin the serialized body to ONLY the
// OpenAI-recognized session fields, so an internal-only field can never leak again.
// They would have failed the instant `maxSessionSeconds` was added — no key needed.

const dirs: string[] = [];
function freshConfigDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-mint-body-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("buildMintSessionWireBody — the allowlist (OBS-001)", () => {
  it("emits ONLY the OpenAI-recognized session fields, dropping every internal-only field", () => {
    const db = freshConfigDb();
    const { config } = buildTutorSessionConfig(db);
    // The internal config really does carry the server-side ceiling that broke the mint.
    expect(config.maxSessionSeconds).toBeGreaterThan(0);

    const wire = buildMintSessionWireBody(config);
    // Exactly the allowlist — no more, no fewer.
    expect(Object.keys(wire).sort()).toEqual([...MINT_SESSION_WIRE_FIELDS].sort());
    // The fabricated field OpenAI 400s on is gone.
    expect("maxSessionSeconds" in wire).toBe(false);
    expect(JSON.stringify(wire)).not.toContain("maxSessionSeconds");

    // The recognized fields pass through untouched (the request stays otherwise-correct).
    expect(wire.type).toBe("realtime");
    expect(wire.model).toBe(config.model);
    expect(wire.instructions).toBe(config.instructions);
    expect(wire.audio).toBe(config.audio);
    expect(wire.tools).toBe(config.tools);
    expect(wire.tool_choice).toBe(config.tool_choice);
    db.close();
  });

  it("cannot leak a NEW internal field added to the config (explicit allowlist, not a spread)", () => {
    const db = freshConfigDb();
    const { config } = buildTutorSessionConfig(db);
    // Simulate a future internal-only field being tacked onto the config object.
    const polluted = { ...config, secretServerOnlyFlag: "must-not-ship", maxSessionSeconds: 1800 };
    const wire = buildMintSessionWireBody(polluted);
    expect("secretServerOnlyFlag" in wire).toBe(false);
    expect("maxSessionSeconds" in wire).toBe(false);
    expect(Object.keys(wire).sort()).toEqual([...MINT_SESSION_WIRE_FIELDS].sort());
    db.close();
  });
});

describe("openAiClientSecretMinter.mint — the bytes actually sent to OpenAI", () => {
  it("POSTs a { session } body carrying ONLY the allowlisted fields (no maxSessionSeconds)", async () => {
    const db = freshConfigDb();
    const { config } = buildTutorSessionConfig(db);

    let sentBody: unknown = null;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ value: "ek_test", expires_at: 1_900_000_000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "FAKE-server-key-not-key-shaped";
    try {
      await openAiClientSecretMinter.mint(config);
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      vi.unstubAllGlobals();
    }

    // The OBS-001-validated request structure is preserved: the { session: {...} } wrapper …
    const body = sentBody as { session?: Record<string, unknown> };
    expect(body.session).toBeTruthy();
    // … carrying exactly the allowlisted session fields …
    expect(Object.keys(body.session ?? {}).sort()).toEqual([...MINT_SESSION_WIRE_FIELDS].sort());
    // … and NOT the internal ceiling that used to 400 the mint.
    expect(JSON.stringify(sentBody)).not.toContain("maxSessionSeconds");
    db.close();
  });
});
