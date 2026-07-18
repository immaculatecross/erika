import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { runAnalysisJob, enqueueAnalysis } from "@/lib/analysis/cascade";
import {
  getSegmentAnalysis,
  listFindings,
} from "@/lib/analysis/findings";
import { sessionSegmentCounts } from "@/lib/findings-model";
import {
  describeResponseShape,
  ModelParseError,
  ModelTruncatedError,
  STRICT_JSON_INSTRUCTION,
  type AudioModelClient,
  type CallOpts,
} from "@/lib/analysis/audio-model";

// E-16b criterion 4. "Analysis failed — Model response was not a JSON object"
// killed a whole run that had already analysed (and paid for) every other
// segment. A truncated reply is now its own error, an unparseable one gets ONE
// repair retry, and a segment that still cannot be read is marked and reported
// while the run completes. Mock client throughout — no network.

const TEMPO = 1.5;
const dirs: string[] = [];

function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-unreadable-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seed(db: Db, sessionId: string, hashes: string[]): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 600 });
  hashes.forEach((hash, idx) => {
    upsertSegment(db, { sessionId, idx, startMs: idx * 60_000, endMs: idx * 60_000 + 60_000, contentHash: hash });
    for (const p of [renditionCachePath(hash, TEMPO), segmentPath(sessionId, idx)]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
    }
  });
}

const hashOf = (b64: string) => Buffer.from(b64, "base64").toString().replace("audio-", "");

/** Every hash is flagged; `bad` hashes throw `error` from deepListen, always. */
function mockClient(bad: Set<string>, error: () => ModelParseError) {
  const deep: { hash: string; opts: CallOpts | undefined }[] = [];
  const client: AudioModelClient = {
    async triage(input) {
      return { flagged: true, reason: hashOf(input.audioBase64) };
    },
    async deepListen(_model, input, opts) {
      const hash = hashOf(input.audioBase64);
      deep.push({ hash, opts });
      if (bad.has(hash)) throw error();
      return {
        findings: [
          {
            quote: "q",
            correction: "c",
            category: "grammar" as const,
            explanation: "why",
            severity: "medium" as const,
            startMs: 0,
            endMs: 0,
            relStartMs: 0,
            relEndMs: 1000,
          },
        ],
      };
    },
  };
  return { client, deep };
}

const run = (db: Db, sessionId: string, client: AudioModelClient) =>
  runAnalysisJob(db, enqueueAnalysis(db, sessionId).id, client, { tempo: TEMPO });

const truncated = () => {
  const err = new ModelTruncatedError("gpt-audio-1.5 reply was cut off at the token limit.");
  err.shape = "finish_reason=length chars=4096 brace=unclosed";
  return err;
};
const unparseable = () => {
  const err = new ModelParseError("Model response was not a JSON object.");
  err.shape = "finish_reason=stop chars=42 brace=none";
  return err;
};

describe("describeResponseShape", () => {
  it("records structure only — never the model's words", () => {
    const shape = describeResponseShape('Sure! Here you go: {"findings": [', "length");
    expect(shape).toBe("finish_reason=length chars=33 brace=unclosed");
    expect(shape).not.toContain("Sure");
    expect(describeResponseShape("{}", "stop")).toBe("finish_reason=stop chars=2 brace=closed");
    expect(describeResponseShape("no json here", null)).toBe("finish_reason=none chars=12 brace=none");
  });
});

describe.each([
  ["a truncated reply", truncated],
  ["an unparseable reply", unparseable],
])("%s leaves the run done with that segment marked", (_label, makeError) => {
  it("completes the run, keeps the other segments, and reports the count", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1", "h2"]);
    const { client } = mockClient(new Set(["h1"]), makeError);
    const job = await run(db, "s1", client);

    expect(job.state).toBe("done"); // NOT failed — this was the operator's bug
    expect(job.progress).toBe(1);
    // The two good segments were analysed and kept; only h1 was lost.
    expect(listFindings(db, "s1").map((f) => f.contentHash)).toEqual(["h0", "h2"]);
    expect(sessionSegmentCounts(db, "s1")).toMatchObject({ segmentCount: 3, analysedCount: 2, unreadableCount: 1 });
    db.close();
  });

  it("persists the failure's reason and content-free shape", async () => {
    const db = ws();
    seed(db, "s1", ["h1"]);
    await run(db, "s1", mockClient(new Set(["h1"]), makeError).client);

    const analysis = getSegmentAnalysis(db, "h1")!;
    expect(analysis.unreadable).toBe(true);
    expect(analysis.responseShape).toBe(makeError().shape);
    const row = db.prepare("SELECT unreadable_reason FROM segment_analyses WHERE content_hash = 'h1'").get() as {
      unreadable_reason: string;
    };
    expect(row.unreadable_reason).toBe(makeError().message);
    db.close();
  });

  it("retries exactly once, and only the retry carries the strict instruction", async () => {
    const db = ws();
    seed(db, "s1", ["h1"]);
    const { client, deep } = mockClient(new Set(["h1"]), makeError);
    await run(db, "s1", client);

    expect(deep).toHaveLength(2); // the attempt and ONE repair retry, never more
    expect(deep[0].opts?.strictJson).toBe(false);
    expect(deep[1].opts?.strictJson).toBe(true);
    db.close();
  });
});

describe("resuming after an unreadable segment", () => {
  it("re-tries the deep call without re-billing the triage", async () => {
    const db = ws();
    seed(db, "s1", ["h1"]);
    await run(db, "s1", mockClient(new Set(["h1"]), unparseable).client);
    const spendAfterFirst = (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
    expect(spendAfterFirst).toBe(3); // mini + two deep attempts

    // Second run: the model behaves. The mini's verdict was kept, so only the
    // deep call is remade — the triage is never paid for twice.
    const { client, deep } = mockClient(new Set(), unparseable);
    const job = await run(db, "s1", client);
    expect(job.state).toBe("done");
    expect(deep).toHaveLength(1);
    expect(getSegmentAnalysis(db, "h1")!.unreadable).toBe(false);
    expect(listFindings(db, "s1")).toHaveLength(1);
    const models = (db.prepare("SELECT model FROM spend_ledger").all() as { model: string }[]).map((r) => r.model);
    expect(models.filter((m) => m === "gpt-audio-mini")).toHaveLength(1);
    db.close();
  });
});

describe("the strict repair instruction", () => {
  it("tells the model plainly what to send instead", () => {
    expect(STRICT_JSON_INSTRUCTION).toMatch(/JSON object ONLY/);
    expect(STRICT_JSON_INSTRUCTION).toMatch(/no markdown code fence/);
  });
});
