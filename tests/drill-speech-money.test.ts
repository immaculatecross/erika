import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { writeSettings } from "@/lib/settings";
import { STT_MODEL, sttCallCost } from "@/lib/analysis/rates";
import {
  DrillAnswerTooLargeError,
  MAX_DRILL_ANSWER_BYTES,
  MAX_DRILL_ANSWER_SECONDS,
  transcribeDrillAnswer,
  type SpeechToText,
} from "@/lib/lessons/speech";
import { BudgetExceededError } from "@/lib/lessons/billing";

// The drill-answer STT money path (E-45, hardened at the Full review).
//
// The reservation used to be priced on a `seconds` value the BROWSER declared, so a
// caller claiming `seconds: 0` reserved nothing and sent whatever it liked — a cap
// that guards a number the caller chose is not a cap. Duration is now ignored for
// pricing and the payload is bounded on bytes, the one quantity the server sees.

const dirs: string[] = [];

function freshDb(budgetUsd = 5): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-stt-money-"));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, "erika.db"));
  writeSettings(db, { monthlyBudgetUsd: budgetUsd });
  return db;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function stt(text = "sono"): { client: SpeechToText; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    client: {
      async transcribe(input) {
        calls.push(input.seconds);
        return { text };
      },
    },
  };
}

const audio = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

function ledger(db: Db) {
  return db
    .prepare("SELECT model, cost_usd, state FROM spend_ledger")
    .all() as { model: string; cost_usd: number; state: string }[];
}

describe("a drill answer is priced at the ceiling, not at what the client claims", () => {
  it("charges the full allowance even when the caller declares zero seconds", () => {
    const db = freshDb();
    const { client } = stt();
    return transcribeDrillAnswer(db, client, {
      audioBase64: audio(1024),
      format: "wav",
      seconds: 0, // the number the old code trusted
      drillKey: "d1",
    }).then(() => {
      const rows = ledger(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("committed");
      expect(rows[0].model).toBe(STT_MODEL);
      // Ground truth from the CONSTANT, not from what the function returned.
      expect(rows[0].cost_usd).toBeCloseTo(sttCallCost(STT_MODEL, MAX_DRILL_ANSWER_SECONDS), 10);
      expect(rows[0].cost_usd).toBeGreaterThan(0);
    });
  });

  it("charges the same for a long claim as for a short one — the claim is ignored", async () => {
    const costs: number[] = [];
    for (const seconds of [0, 2, 999]) {
      const db = freshDb();
      await transcribeDrillAnswer(db, stt().client, { audioBase64: audio(1024), format: "wav", seconds, drillKey: "d" });
      costs.push(ledger(db)[0].cost_usd);
    }
    expect(new Set(costs.map((c) => c.toFixed(10))).size).toBe(1);
  });

  it("refuses an oversized payload before reserving or calling anything", async () => {
    const db = freshDb();
    const { client, calls } = stt();
    await expect(
      transcribeDrillAnswer(db, client, {
        audioBase64: audio(MAX_DRILL_ANSWER_BYTES + 1024),
        format: "wav",
        seconds: 1,
        drillKey: "d",
      }),
    ).rejects.toBeInstanceOf(DrillAnswerTooLargeError);
    // No call, and no row — a refusal must not cost anything.
    expect(calls).toHaveLength(0);
    expect(ledger(db)).toHaveLength(0);
  });

  it("refuses when the cap is already spent, without calling the provider", async () => {
    const db = freshDb(0);
    const { client, calls } = stt();
    await expect(
      transcribeDrillAnswer(db, client, { audioBase64: audio(512), format: "wav", seconds: 2, drillKey: "d" }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0);
    expect(ledger(db).filter((r) => r.state === "committed")).toHaveLength(0);
  });

  it("releases the reservation when the provider fails — nothing was billed", async () => {
    const db = freshDb();
    const failing: SpeechToText = {
      async transcribe() {
        throw new Error("provider down");
      },
    };
    await expect(
      transcribeDrillAnswer(db, failing, { audioBase64: audio(512), format: "wav", seconds: 2, drillKey: "d" }),
    ).rejects.toThrow("provider down");
    expect(ledger(db).filter((r) => r.state === "committed")).toHaveLength(0);
  });

  it("two attempts at the same drill are two real charges", async () => {
    const db = freshDb();
    for (let i = 0; i < 2; i++) {
      await transcribeDrillAnswer(db, stt().client, { audioBase64: audio(512), format: "wav", seconds: 2, drillKey: "same" });
    }
    expect(ledger(db).filter((r) => r.state === "committed")).toHaveLength(2);
  });
});
