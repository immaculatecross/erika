import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import {
  retryOnRateLimit,
  backoffDelay,
  parseRetryAfter,
  ModelRateLimitError,
  ModelUnavailableError,
  ModelParseError,
} from "@/lib/analysis/audio-model";
import { reserveSpend, finalizeReservation, monthToDateSpend } from "@/lib/analysis/budget";

// E-27 criterion 5 — a 429 is retried a bounded number of times with jittered
// backoff that honors Retry-After; exhausting the retries surfaces as
// ModelUnavailableError (no charge, tries the D-3 fallback). The retries are
// transparent to billing: a call reserves and charges exactly once no matter how
// many 429s it weathered. sleep/random are injected so nothing waits on a clock.

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-retry-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds and an HTTP-date, and shrugs off garbage", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("not-a-number")).toBeUndefined();
    const now = Date.parse("2026-07-23T00:00:00Z");
    expect(parseRetryAfter("Thu, 23 Jul 2026 00:00:03 GMT", now)).toBe(3000);
  });
});

describe("backoffDelay", () => {
  it("never sleeps less than a server-requested Retry-After", () => {
    // Small exponential base, large Retry-After → the wait honors Retry-After.
    const d = backoffDelay(0, 5000, { baseMs: 100, maxMs: 20_000, random: () => 0 });
    expect(d).toBeGreaterThanOrEqual(5000);
  });
  it("grows exponentially but stays capped, with jitter on top", () => {
    const noJitter = (a: number) => backoffDelay(a, undefined, { baseMs: 100, maxMs: 2000, random: () => 0 });
    expect(noJitter(0)).toBe(100);
    expect(noJitter(1)).toBe(200);
    expect(noJitter(2)).toBe(400);
    expect(noJitter(10)).toBe(2000); // capped at maxMs
    // Jitter only ever adds (random in [0,1)).
    expect(backoffDelay(0, undefined, { baseMs: 100, maxMs: 2000, random: () => 1 })).toBeGreaterThan(100);
  });
});

describe("retryOnRateLimit", () => {
  it("retries a 429 then succeeds, honoring the Retry-After wait", async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await retryOnRateLimit(
      async () => {
        calls += 1;
        if (calls === 1) throw new ModelRateLimitError("429", 50);
        return "ok";
      },
      { sleep: async (ms) => void slept.push(ms), random: () => 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2); // one 429, one success
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(50); // honored the requested wait
  });

  it("exhausts a bounded number of retries, then surfaces as ModelUnavailableError", async () => {
    const slept: number[] = [];
    let calls = 0;
    await expect(
      retryOnRateLimit(
        async () => {
          calls += 1;
          throw new ModelRateLimitError("429", 1);
        },
        { retries: 2, sleep: async (ms) => void slept.push(ms), random: () => 0 },
      ),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(calls).toBe(3); // the initial attempt + exactly 2 retries
    expect(slept).toHaveLength(2); // one sleep before each retry, none after the last
  });

  it("passes a non-rate-limit error straight through — no retry, no sleep", async () => {
    const slept: number[] = [];
    let calls = 0;
    await expect(
      retryOnRateLimit(
        async () => {
          calls += 1;
          throw new ModelParseError("garbage");
        },
        { sleep: async (ms) => void slept.push(ms) },
      ),
    ).rejects.toBeInstanceOf(ModelParseError);
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it("bills exactly once for a 429-then-success: one reservation, one committed charge", async () => {
    const db = freshDb();
    // The cascade reserves ONCE around the whole call-with-retries; the 429 retries
    // happen inside that single reserved call and reserve nothing themselves.
    const r = reserveSpend(db, { model: "gpt-audio-1.5", contentHash: "h", costUsd: 0.06 }, 10)!;
    let calls = 0;
    await retryOnRateLimit(
      async () => {
        calls += 1;
        if (calls === 1) throw new ModelRateLimitError("429", 1);
        return "completion";
      },
      { sleep: async () => {}, random: () => 0 },
    );
    finalizeReservation(db, r, 0.06);
    expect(monthToDateSpend(db)).toBeCloseTo(0.06, 9);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(1);
    db.close();
  });
});
