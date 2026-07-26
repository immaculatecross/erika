import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";
import type { SpeechToText, TextToSpeech } from "@/lib/voice/speech";
import type { TerraClient } from "@/lib/tutor/terra";

let root: string;
let getDb: typeof import("@/lib/db").getDb;
let openConversation: typeof import("@/lib/tutor/conversations").openConversation;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let handleTranscriptTurn: typeof import("@/lib/tutor/transcript-turn-route").handleTranscriptTurn;
let handleSpeak: typeof import("@/lib/tutor/speak-route").handleSpeak;

beforeAll(async () => {
  root = tmpDir("erika-tutor-turn-routes-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  process.env.OPENAI_API_KEY = "test-server-key";
  ({ getDb } = await import("@/lib/db"));
  ({ openConversation } = await import("@/lib/tutor/conversations"));
  ({ writeSettings } = await import("@/lib/settings"));
  ({ handleTranscriptTurn } = await import("@/lib/tutor/transcript-turn-route"));
  ({ handleSpeak } = await import("@/lib/tutor/speak-route"));
});

afterEach(() => {
  getDb().prepare("DELETE FROM evidence").run();
  getDb().prepare("DELETE FROM spend_ledger").run();
  getDb().prepare("DELETE FROM tutor_conversations").run();
  writeSettings(getDb(), { monthlyBudgetUsd: 25 });
});

afterAll(() => {
  delete process.env.OPENAI_API_KEY;
  fs.rmSync(root, { recursive: true, force: true });
});

function open(id: string) {
  openConversation(getDb(), id, 0);
}

function turnRequest(
  tutorId: string,
  seq: string,
  preset = "balanced",
): Request {
  const form = new FormData();
  form.append("tutorId", tutorId);
  form.append("seq", seq);
  form.append("preset", preset);
  form.append("context", JSON.stringify([{ learner: "Ciao", tutor: "Dimmi pure." }]));
  form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "turn.webm");
  return new Request("http://localhost/api/tutor/turn", { method: "POST", body: form });
}

const cleanResult = JSON.stringify({
  errors: [],
  reply: "Raccontami che cosa è successo dopo.",
  evidence: [],
});

function fakeStt(text = "Ieri ho andato al cinema.") {
  return {
    id: "fake-stt",
    isAvailable: () => true,
    transcribe: vi.fn(async () => ({
      text,
      source: "fake-stt",
      usage: { inputTokens: 10, outputTokens: 5 },
    })),
  } satisfies SpeechToText;
}

function fakeTerra(outputs: string[]) {
  let index = 0;
  return {
    complete: vi.fn(async (input: Parameters<TerraClient["complete"]>[0]) => {
      void input;
      return {
        text: outputs[Math.min(index++, outputs.length - 1)],
        usage: {
          inputTokens: 100,
          cachedInputTokens: 20,
          cacheWriteTokens: 0,
          outputTokens: 30,
          reasoningTokens: 5,
        },
        responseId: "resp_test",
      };
    }),
  } satisfies TerraClient;
}

describe("POST /api/tutor/turn", () => {
  it("runs exactly one bounded STT → selected Terra turn and drops transcript pronunciation", async () => {
    open("turn-1");
    const stt = fakeStt();
    const terra = fakeTerra([
      JSON.stringify({
        errors: [
          {
            quote: "andato",
            correction: "andato",
            category: "pronunciation",
            explanation: "A transcript cannot prove this.",
            confidence: "high",
          },
        ],
        reply: "Sei andato al cinema?",
        evidence: [],
      }),
    ]);
    const response = await handleTranscriptTurn(turnRequest("turn-1", "1", "precision"), {
      stt,
      terra,
      probe: async () => 2,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(stt.transcribe).toHaveBeenCalledTimes(1);
    expect(stt.transcribe).toHaveBeenCalledWith(expect.objectContaining({ language: "it" }));
    expect(terra.complete).toHaveBeenCalledTimes(1);
    expect(terra.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: "Ieri ho andato al cinema.",
        context: [{ learner: "Ciao", tutor: "Dimmi pure." }],
      }),
    );
    expect(body.transcript).toBe("Ieri ho andato al cinema.");
    expect(body.result.errors).toEqual([]);
    expect(body.droppedErrors).toEqual([
      expect.objectContaining({ category: "pronunciation" }),
    ]);
    expect(body.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.costs.committedUsd).toBeGreaterThan(0);
  });

  it("blocks a duplicate sequence before a second billable turn", async () => {
    open("turn-duplicate");
    const stt = fakeStt();
    const terra = fakeTerra([cleanResult]);
    const deps = { stt, terra, probe: async () => 1 };
    expect((await handleTranscriptTurn(turnRequest("turn-duplicate", "7"), deps)).status).toBe(200);
    const duplicate = await handleTranscriptTurn(turnRequest("turn-duplicate", "7"), deps);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("duplicate_turn");
    expect(stt.transcribe).toHaveBeenCalledTimes(1);
    expect(terra.complete).toHaveBeenCalledTimes(1);
  });

  it("charges two resolved Terra attempts but returns no result after bounded repair", async () => {
    open("turn-invalid");
    const stt = fakeStt();
    const terra = fakeTerra(["```json\n{}\n```", '{"errors":[]']);
    const response = await handleTranscriptTurn(turnRequest("turn-invalid", "1"), {
      stt,
      terra,
      probe: async () => 1,
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.recoverable).toBe(true);
    expect(body.result).toBeUndefined();
    expect(terra.complete).toHaveBeenCalledTimes(2);
    expect(terra.complete.mock.calls[1][0].repairOf).toContain("```json");
    const rows = getDb()
      .prepare("SELECT model, state FROM spend_ledger ORDER BY model")
      .all() as { model: string; state: string }[];
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.state === "committed")).toBe(true);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n,
    ).toBe(0);
  });

  it("refuses at the cap before STT or Terra and leaves no ledger row", async () => {
    open("turn-blocked");
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const stt = fakeStt();
    const terra = fakeTerra([cleanResult]);
    const response = await handleTranscriptTurn(turnRequest("turn-blocked", "1"), {
      stt,
      terra,
      probe: async () => 1,
    });
    expect(response.status).toBe(402);
    expect(stt.transcribe).not.toHaveBeenCalled();
    expect(terra.complete).not.toHaveBeenCalled();
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n,
    ).toBe(0);
  });
});

function fakeTts(): TextToSpeech & {
  synthesizeStream: ReturnType<typeof vi.fn>;
} {
  const synthesizeStream = vi.fn(async function* () {
    yield new Uint8Array([1, 2, 3]);
    yield new Uint8Array([4, 5]);
  });
  return {
    id: "fake-tts",
    voice: "coral",
    isAvailable: () => true,
    synthesize: vi.fn(async () => ({
      audio: new Uint8Array([1]),
      mimeType: "audio/mpeg",
      source: "fake-tts",
    })),
    synthesizeStream,
  };
}

function speakRequest(tutorId: string, seq: number): Request {
  return new Request("http://localhost/api/tutor/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tutorId, seq, text: "Una risposta breve." }),
  });
}

describe("POST /api/tutor/speak", () => {
  it("streams the common TTS leg, settles bytes, and rejects a duplicate sequence", async () => {
    open("speak-1");
    const tts = fakeTts();
    const response = await handleSpeak(speakRequest("speak-1", 1), { tts });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-tutor-model")).toBe("gpt-4o-mini-tts");
    expect(response.headers.get("x-tutor-voice")).toBe("coral");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(tts.synthesizeStream).toHaveBeenCalledTimes(1);
    expect(
      (getDb().prepare("SELECT state FROM spend_ledger").get() as { state: string }).state,
    ).toBe("committed");

    const duplicate = await handleSpeak(speakRequest("speak-1", 1), { tts });
    expect(duplicate.status).toBe(409);
    expect(tts.synthesizeStream).toHaveBeenCalledTimes(1);
  });

  it("refuses at the cap without calling TTS", async () => {
    open("speak-blocked");
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const tts = fakeTts();
    const response = await handleSpeak(speakRequest("speak-blocked", 1), { tts });
    expect(response.status).toBe(402);
    expect(tts.synthesizeStream).not.toHaveBeenCalled();
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n,
    ).toBe(0);
  });
});
