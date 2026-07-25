import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route reads the DB through `getDb()`, so the disposable database is installed
// via ERIKA_DB_PATH BEFORE the module graph loads. Never `data/erika.db`.
const dirs: string[] = [];
function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-speak-"));
  dirs.push(dir);
  return path.join(dir, "erika.db");
}

let handleSpeak: typeof import("@/lib/tutor/speak").handleSpeak;
let getDb: typeof import("@/lib/db").getDb;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let monthToDateSpend: typeof import("@/lib/analysis/budget").monthToDateSpend;
let ttsCallCost: typeof import("@/lib/analysis/rates").ttsCallCost;
let ttsAudioSecondsFromMp3Bytes: typeof import("@/lib/analysis/rates").ttsAudioSecondsFromMp3Bytes;
let TTS_MODEL: typeof import("@/lib/analysis/rates").TTS_MODEL;

beforeEach(async () => {
  vi.resetModules();
  process.env.ERIKA_DB_PATH = tmpDbPath();
  // A non-empty placeholder ONLY so the route sees "a key is configured". Every test
  // in this file injects a fake vendor, so nothing here ever reaches a network.
  process.env.OPENAI_API_KEY = "not-a-key-the-fakes-never-call-out";
  ({ handleSpeak } = await import("@/lib/tutor/speak"));
  ({ getDb } = await import("@/lib/db"));
  ({ writeSettings } = await import("@/lib/settings"));
  ({ monthToDateSpend } = await import("@/lib/analysis/budget"));
  const rates = await import("@/lib/analysis/rates");
  ttsCallCost = rates.ttsCallCost;
  ttsAudioSecondsFromMp3Bytes = rates.ttsAudioSecondsFromMp3Bytes;
  TTS_MODEL = rates.TTS_MODEL;
});
afterEach(() => {
  delete process.env.ERIKA_DB_PATH;
  delete process.env.OPENAI_API_KEY;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// THE SPEAKING LEG, AND THE PROOF OF THE SEAM (E-43 criteria 2, 8).
//
// Criterion 2 asks for the seam to be proven by writing a SECOND, trivial
// implementation and swapping it with no change to the loop. There are two here — a
// streaming one and a deliberately non-streaming one — plus a failing one and an
// unavailable one, and the route takes each without knowing anything about it. If the
// route ever reached for a concrete vendor, these tests could not exist.

const REPLY = "Ciao! Come è andata la giornata? Raccontami qualcosa di interessante.";

/** A streaming fake: emits bytes in chunks, like the real SSE decoder does. */
function streamingFake(chunkCount = 3, bytesPerChunk = 8_000) {
  const calls: { text: string }[] = [];
  return {
    calls,
    tts: {
      id: "fake:streaming",
      voice: "fake-voice",
      isAvailable: () => true,
      async synthesize({ text }: { text: string }) {
        calls.push({ text });
        return { audio: new Uint8Array(chunkCount * bytesPerChunk), mimeType: "audio/mpeg", source: "fake" };
      },
      async *synthesizeStream({ text }: { text: string }) {
        calls.push({ text });
        for (let i = 0; i < chunkCount; i += 1) yield new Uint8Array(bytesPerChunk);
      },
    },
  };
}

/** A SECOND implementation, deliberately trivial and NON-streaming — the conformance
 *  proof that `synthesizeStream` is genuinely optional (spike-5 §6, point 4). */
function blockingFake(bytes = 16_000) {
  const calls: { text: string }[] = [];
  return {
    calls,
    tts: {
      id: "fake:blocking",
      voice: "other-voice",
      isAvailable: () => true,
      async synthesize({ text }: { text: string }) {
        calls.push({ text });
        return { audio: new Uint8Array(bytes), mimeType: "audio/mpeg", source: "fake2" };
      },
    },
  };
}

function speakRequest(body: unknown): Request {
  return new Request("http://localhost/api/tutor/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function drain(res: Response): Promise<number> {
  const buf = await res.arrayBuffer();
  return buf.byteLength;
}

describe("the seam: two implementations, one unchanged route", () => {
  it("speaks through a STREAMING implementation", async () => {
    const fake = streamingFake(3, 8_000);
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: fake.tts });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(await drain(res)).toBe(24_000);
    expect(fake.calls).toEqual([{ text: REPLY }]);
  });

  it("speaks through a NON-STREAMING implementation, with no change to the route", async () => {
    const fake = blockingFake(16_000);
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: fake.tts });
    expect(res.status).toBe(200);
    expect(await drain(res)).toBe(16_000);
    expect(fake.calls).toEqual([{ text: REPLY }]);
  });

  it("reports which voice answered, so a swap is observable", async () => {
    const a = await handleSpeak(speakRequest({ tutorId: "t", seq: 0, text: REPLY }), { tts: streamingFake().tts });
    const b = await handleSpeak(speakRequest({ tutorId: "t", seq: 1, text: REPLY }), { tts: blockingFake().tts });
    expect(a.headers.get("x-tutor-voice")).toBe("fake-voice");
    expect(b.headers.get("x-tutor-voice")).toBe("other-voice");
    await drain(a);
    await drain(b);
  });
});

describe("money: reserve before the call, finalize on resolve", () => {
  it("charges the HONEST duration-derived cost, below the pre-call character bound", async () => {
    const fake = streamingFake(3, 8_000); // 24 000 bytes = 1.5 s of 128 kbps mp3
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: fake.tts });
    await drain(res);
    const db = getDb();
    const spent = monthToDateSpend(db);
    expect(spent).toBeGreaterThan(0);
    // The reservation bounded it at the slowest-voice character rate; the charge is
    // computed from the audio that actually exists, which is less.
    expect(spent).toBeLessThan(ttsCallCost(TTS_MODEL, REPLY.length));
    expect(ttsAudioSecondsFromMp3Bytes(24_000)).toBeCloseTo(1.5, 6);
    // Exactly one committed row, no pending remnant.
    const rows = db
      .prepare("SELECT state, COUNT(*) AS n FROM spend_ledger GROUP BY state")
      .all() as { state: string; n: number }[];
    expect(rows).toEqual([{ state: "committed", n: 1 }]);
  });

  it("REFUSES at the cap before any vendor call, and mints no charge", async () => {
    const db = getDb();
    writeSettings(db, { monthlyBudgetUsd: 0 });
    const fake = streamingFake();
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: fake.tts });
    expect(res.status).toBe(402);
    expect(fake.calls).toHaveLength(0); // the vendor was never touched
    expect(monthToDateSpend(db)).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
  });

  it("a crash with audio ALREADY ON THE WIRE still records the spend", async () => {
    // The never-waivable half: bytes that reached the browser were synthesized and
    // invoiced, so they are billed even though the stream then failed.
    const failing = {
      id: "fake:dies",
      voice: "v",
      isAvailable: () => true,
      async synthesize() {
        throw new Error("no");
      },
      async *synthesizeStream() {
        yield new Uint8Array(16_000);
        throw new Error("connection reset mid-stream");
      },
    };
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: failing });
    await drain(res).catch(() => 0);
    const db = getDb();
    expect(monthToDateSpend(db)).toBeGreaterThan(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number }).n,
    ).toBe(0);
  });

  it("a failure BEFORE any audio releases the reservation and charges nothing", async () => {
    const failing = {
      id: "fake:dies-early",
      voice: "v",
      isAvailable: () => true,
      async synthesize(): Promise<never> {
        throw new Error("nope");
      },
      async *synthesizeStream(): AsyncIterable<Uint8Array> {
        throw new Error("refused before a single byte");
      },
    };
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: failing });
    await drain(res).catch(() => 0);
    const db = getDb();
    expect(monthToDateSpend(db)).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
  });

  it("each chunk of a turn bills separately and none overwrites another", async () => {
    const fake = streamingFake(1, 8_000);
    for (const seq of [0, 1, 2]) {
      await drain(await handleSpeak(speakRequest({ tutorId: "t1", seq, text: REPLY }), { tts: fake.tts }));
    }
    const db = getDb();
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='committed'").get() as { n: number }).n,
    ).toBe(3);
  });
});

describe("truthful refusals", () => {
  it("says plainly that a key is needed, rather than leaking an internal error", async () => {
    const unavailable = {
      id: "fake:nokey",
      voice: "v",
      isAvailable: () => false,
      async synthesize(): Promise<never> {
        throw new Error("should never be called");
      },
    };
    const res = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: REPLY }), { tts: unavailable });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/API key/i);
    expect(body.error.message).toMatch(/Settings/i);
    expect(monthToDateSpend(getDb())).toBe(0);
  });

  it("rejects an empty or oversized chunk without spending", async () => {
    const fake = streamingFake();
    const empty = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: "  " }), { tts: fake.tts });
    expect(empty.status).toBe(400);
    const huge = await handleSpeak(speakRequest({ tutorId: "t1", seq: 0, text: "a".repeat(5_000) }), {
      tts: fake.tts,
    });
    expect(huge.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    expect(monthToDateSpend(getDb())).toBe(0);
  });
});
