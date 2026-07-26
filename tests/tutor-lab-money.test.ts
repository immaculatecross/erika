import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  TERRA_MODEL,
  TERRA_RATES,
  TTS_MODEL,
  TTS_MP3_BYTES_PER_SECOND,
  TTS_RATES,
  TUTOR_STT_MODEL,
  STT_RATES,
  REALTIME_FLAGSHIP,
  REALTIME_RATES,
  realtimeTurnUsageCost,
  sttCallCost,
  terraUsageCost,
  ttsCostFromAudioSeconds,
} from "@/lib/analysis/rates";
import { monthToDateSpend, sweepStaleReservations } from "@/lib/analysis/budget";
import {
  reserveTerraLeg,
  reserveTranscriptLeg,
  settleTerraLeg,
  settleTranscriptLeg,
} from "@/lib/tutor/turn-money";
import {
  reserveTutorSpeech,
  settleTutorSpeech,
  tutorConversationCommittedUsd,
} from "@/lib/tutor/money";

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-lab-money-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const perMillion = (rate: number) => rate * 1_000_000;

describe("every tutor-lab rate is a leg-wise floor", () => {
  it("prices Realtime text input/cache/output and audio input at published floors", () => {
    const rate = REALTIME_RATES[REALTIME_FLAGSHIP];
    expect(perMillion(rate.usdPerAudioInputToken)).toBeGreaterThanOrEqual(32);
    expect(perMillion(rate.usdPerTextInputToken)).toBeGreaterThanOrEqual(4);
    expect(perMillion(rate.usdPerCachedTextInputToken)).toBeGreaterThanOrEqual(0.4);
    expect(perMillion(rate.usdPerTextOutputToken)).toBeGreaterThanOrEqual(24);
    const cost = realtimeTurnUsageCost(REALTIME_FLAGSHIP, {
      inputTokens: 200,
      cachedInputTokens: 20,
      audioInputTokens: 100,
      cachedAudioInputTokens: 10,
      outputTokens: 100,
      reasoningTokens: 10,
    });
    expect(cost.inputUsd).toBeGreaterThan(0);
    expect(cost.cachedInputUsd).toBeGreaterThan(0);
    expect(cost.outputUsd).toBeGreaterThan(0);
  });

  it("prices STT, Terra input/cache-write/cache-read/output, and TTS above zero", () => {
    expect(STT_RATES[TUTOR_STT_MODEL].usdPerAudioMinute).toBeGreaterThanOrEqual(0.006);
    const terra = TERRA_RATES[TERRA_MODEL];
    expect(perMillion(terra.usdPerInputToken)).toBeGreaterThanOrEqual(2.5);
    expect(perMillion(terra.usdPerCacheWriteToken)).toBeGreaterThanOrEqual(3.125);
    expect(perMillion(terra.usdPerCachedInputToken)).toBeGreaterThanOrEqual(0.25);
    expect(perMillion(terra.usdPerOutputToken)).toBeGreaterThanOrEqual(15);
    expect(perMillion(TTS_RATES[TTS_MODEL].usdPerTextInputToken)).toBeGreaterThanOrEqual(0.6);
    expect(perMillion(TTS_RATES[TTS_MODEL].usdPerAudioOutputToken)).toBeGreaterThanOrEqual(12);
  });
});

describe("per-turn reservations use the one spend ledger", () => {
  it("reserves before each provider and settles all three transcript legs to actual", () => {
    const db = freshDb();
    const transcript = reserveTranscriptLeg(db, {
      tutorId: "conversation",
      seq: "1",
      durationSeconds: 2,
      budgetUsd: 100,
    });
    expect(transcript).not.toBeNull();
    settleTranscriptLeg(db, transcript!, 1);

    const terra = reserveTerraLeg(db, {
      tutorId: "conversation",
      seq: "1",
      prompt: "prompt",
      context: "context",
      budgetUsd: 100,
      repair: false,
    });
    expect(terra).not.toBeNull();
    const usage = {
      inputTokens: 100,
      cachedInputTokens: 20,
      cacheWriteTokens: 10,
      outputTokens: 30,
      reasoningTokens: 5,
    };
    settleTerraLeg(db, terra!, usage);

    const speech = reserveTutorSpeech(db, "conversation", 1, "Una risposta breve.", 100);
    expect(speech).not.toBeNull();
    settleTutorSpeech(
      db,
      speech!,
      "Una risposta breve.",
      TTS_MP3_BYTES_PER_SECOND * 2,
    );

    const committed = db
      .prepare("SELECT model, cost_usd FROM spend_ledger WHERE state='committed' ORDER BY model")
      .all() as { model: string; cost_usd: number }[];
    expect(committed).toHaveLength(3);
    expect(committed.find((row) => row.model === TUTOR_STT_MODEL)?.cost_usd).toBeCloseTo(
      sttCallCost(TUTOR_STT_MODEL, 1),
    );
    expect(committed.find((row) => row.model === TERRA_MODEL)?.cost_usd).toBeCloseTo(
      terraUsageCost(usage, TERRA_MODEL).totalUsd,
    );
    expect(committed.find((row) => row.model === TTS_MODEL)?.cost_usd).toBeCloseTo(
      ttsCostFromAudioSeconds(TTS_MODEL, 2, "Una risposta breve.".length),
    );
    expect(tutorConversationCommittedUsd(db, "conversation")).toBeGreaterThan(0);
    expect(monthToDateSpend(db)).toBeCloseTo(
      committed.reduce((sum, row) => sum + row.cost_usd, 0),
    );
    db.close();
  });

  it("a cap refusal creates no reservation and authorizes no provider leg", () => {
    const db = freshDb();
    expect(
      reserveTranscriptLeg(db, {
        tutorId: "blocked",
        seq: "1",
        durationSeconds: 1,
        budgetUsd: 0,
      }),
    ).toBeNull();
    expect(
      reserveTerraLeg(db, {
        tutorId: "blocked",
        seq: "1",
        prompt: "prompt",
        context: "context",
        budgetUsd: 0,
        repair: false,
      }),
    ).toBeNull();
    expect(reserveTutorSpeech(db, "blocked-speech", 1, "Ciao", 0)).toBeNull();
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("an abandoned TTS stream is conservatively committed by the stale sweep", () => {
    const db = freshDb();
    const reservation = reserveTutorSpeech(db, "abandoned", 1, "Ciao", 100);
    expect(reservation).not.toBeNull();
    db.prepare(
      "UPDATE spend_ledger SET reserved_at = datetime('now','-30 minutes') WHERE id = ?",
    ).run(reservation!.id);
    expect(sweepStaleReservations(db)).toBe(1);
    const row = db
      .prepare("SELECT state, cost_usd FROM spend_ledger WHERE content_hash = ?")
      .get(reservation!.contentHash) as { state: string; cost_usd: number };
    expect(row.state).toBe("committed");
    expect(row.cost_usd).toBeCloseTo(reservation!.costUsd);
    db.close();
  });
});
