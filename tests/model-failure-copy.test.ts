import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lessonModelErrorResponse } from "@/app/api/lessons/errors";
import { askModelErrorResponse, voiceModelErrorResponse } from "@/app/api/model-errors";
import {
  TextModelNotConfiguredError,
  TextModelParseError,
  TextModelUnavailableError,
} from "@/lib/lessons/text-model";
import { TtsModelNotConfiguredError, TtsModelUnavailableError } from "@/lib/render/tts-model";
import {
  hasAnalysisKey,
  isRetryableCause,
  modelNotConfiguredMessage,
  REQUIRED_KEY,
} from "@/lib/env-file";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { drillGate } from "@/lib/pronunciation/types";
import { getVisit } from "@/lib/pronunciation/attempts";

// E-39 §B3/§B4/§B5 — a failure tells the truth about its own permanence, and every
// failure branch offers the action that resolves it.
//
// Every model surface answered "… is unavailable right now" for BOTH a transient blip and
// a permanent "no key is configured here", with no retry control. On the shipped default
// that made all 13 rows of /practice/learn walls promising transience, so a person retried
// every one before concluding anything, and the one thing that would have fixed it was
// never named. [RETRO-004 §DE-3, §DE-4, §DE-5]
//
// The expectations come from the CAUSE, which is the fixture here: a not-configured error
// must produce permanent copy and no retry; anything else must produce retryable copy.
// Both directions are asserted, because withholding a retry from someone who could use it
// is the mirror defect.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-failure-copy-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

interface Envelope {
  error: string;
  cause: string;
  retryable: boolean;
}

async function envelope(res: Response): Promise<Envelope> {
  return (await res.json()) as Envelope;
}

describe("a missing key is reported as permanent, and names the fix", () => {
  const surfaces: { name: string; run: () => Response }[] = [
    { name: "lessons", run: () => lessonModelErrorResponse(new TextModelNotConfiguredError("x")) },
    { name: "the voice", run: () => voiceModelErrorResponse(new TtsModelNotConfiguredError("x")) },
    { name: "Ask Erika", run: () => askModelErrorResponse(new TextModelNotConfiguredError("x")) },
  ];

  for (const surface of surfaces) {
    it(`${surface.name}: no "right now", no retry, and the key is named`, async () => {
      const res = surface.run();
      const body = await envelope(res);

      expect(body.cause).toBe("not-configured");
      // No retry may be offered for a condition retrying cannot change.
      expect(body.retryable).toBe(false);
      // The copy must name the cause and the exact fix — the standard set by the
      // keyless-ingest notice (`analysisUnavailableMessage`).
      expect(body.error).toContain(REQUIRED_KEY);
      expect(body.error).toContain(".env.local");
      // …and must NOT promise transience.
      expect(body.error).not.toMatch(/right now|just now|temporar/i);
      // This server's configuration, not the upstream's: 503, never a 502 blaming a
      // vendor nothing was ever sent to.
      expect(res.status).toBe(503);
    });
  }
});

describe("a genuinely transient failure keeps its retry — the mirror defect", () => {
  const cases: { name: string; run: () => Response; cause: string }[] = [
    {
      name: "lessons, endpoint unreachable",
      run: () => lessonModelErrorResponse(new TextModelUnavailableError("boom")),
      cause: "unavailable",
    },
    {
      name: "lessons, unreadable reply",
      run: () => lessonModelErrorResponse(new TextModelParseError("boom")),
      cause: "unreadable",
    },
    {
      name: "the voice, endpoint unreachable",
      run: () => voiceModelErrorResponse(new TtsModelUnavailableError("boom")),
      cause: "unavailable",
    },
    {
      name: "Ask Erika, unreadable reply",
      run: () => askModelErrorResponse(new TextModelParseError("boom")),
      cause: "unreadable",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: retryable, and says so`, async () => {
      const body = await envelope(c.run());
      expect(body.cause).toBe(c.cause);
      expect(body.retryable).toBe(true);
      // It must not tell the learner to go edit a file over a passing blip.
      expect(body.error).not.toContain(".env.local");
    });
  }

  it("classifies every cause, and only 'not-configured' refuses a retry", () => {
    expect(isRetryableCause("not-configured")).toBe(false);
    expect(isRetryableCause("unavailable")).toBe(true);
    expect(isRetryableCause("unreadable")).toBe(true);
  });

  it("does not swallow an error it does not recognise", () => {
    // Silently turning an unknown bug into a polite sentence is how a real fault becomes
    // invisible. It must keep throwing.
    expect(() => lessonModelErrorResponse(new Error("something else"))).toThrow("something else");
    expect(() => voiceModelErrorResponse(new Error("something else"))).toThrow("something else");
  });
});

describe("a keyless client reports NOT-CONFIGURED, not a network error", () => {
  // [E-39 §B3] The defect this pins was found by DRIVING the built keyless server, and no
  // amount of reading had caught it: every real client resolved the key INSIDE the header
  // expression of its `fetch`, inside the try block, so a missing key was caught by the
  // network handler and rethrown as "Network error calling …" — the wrong CLASS for the
  // lesson and TTS clients (so the wall went back to promising transience with a retry that
  // could never work), and a sentence describing a request that never left the process.
  //
  // The assertion is on the CLASS the client throws with no key set, which is the contract
  // every error mapping above depends on.
  const cases: { name: string; call: () => Promise<unknown>; expected: new () => Error }[] = [
    {
      name: "the lesson text model",
      call: async () => {
        const { openAiTextModel } = await import("@/lib/lessons/text-model");
        return openAiTextModel.complete({ prompt: "x", maxOutputTokens: 8 });
      },
      expected: TextModelNotConfiguredError,
    },
    {
      name: "the TTS model",
      call: async () => {
        const { openAiTtsModel } = await import("@/lib/render/tts-model");
        return openAiTtsModel.synthesize({ text: "ciao" });
      },
      expected: TtsModelNotConfiguredError,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: throws the not-configured error, never a network error`, async () => {
      const before = process.env[REQUIRED_KEY];
      try {
        delete process.env[REQUIRED_KEY];
        await expect(c.call()).rejects.toBeInstanceOf(c.expected);
        // …and it must not describe a network attempt that never happened.
        await expect(c.call()).rejects.toThrow(/is not set/);
        await expect(c.call()).rejects.not.toThrow(/Network error/);
      } finally {
        if (before === undefined) delete process.env[REQUIRED_KEY];
        else process.env[REQUIRED_KEY] = before;
      }
    });
  }
});

describe("the not-configured sentence itself", () => {
  it("names the capability, the key and the file, and states the permanence", () => {
    const msg = modelNotConfiguredMessage("lessons");
    expect(msg).toContain("lessons");
    expect(msg).toContain(REQUIRED_KEY);
    expect(msg).toContain(".env.local");
    expect(msg).toContain("will not change on its own");
    expect(msg).not.toMatch(/right now|just now/i);
  });
});

describe("Settings reports whether a key exists — a boolean, never the key (§B5)", () => {
  it("answers from the environment and leaks nothing", () => {
    const before = process.env[REQUIRED_KEY];
    try {
      delete process.env[REQUIRED_KEY];
      expect(hasAnalysisKey()).toBe(false);
      process.env[REQUIRED_KEY] = "   "; // blank counts as absent
      expect(hasAnalysisKey()).toBe(false);
      process.env[REQUIRED_KEY] = "sk-not-a-real-key";
      expect(hasAnalysisKey()).toBe(true);
    } finally {
      if (before === undefined) delete process.env[REQUIRED_KEY];
      else process.env[REQUIRED_KEY] = before;
    }
  });
});

describe("the studio drill can retire on a server with no voice (§B4)", () => {
  /** One pronunciation finding with its witness — enough for a drill to exist. */
  function seedDrill(db: Db): string {
    createSession(db, {
      id: "s1",
      originalFilename: "s.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
    });
    db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES ('j1', 's1', 'done')").run();
    upsertSegment(db, { sessionId: "s1", idx: 0, startMs: 0, endMs: 1000, contentHash: "h1" });
    persistSegmentFindings(db, {
      sessionId: "s1",
      contentHash: "h1",
      flagged: true,
      deepDone: true,
      findings: [
        {
          quote: "la casa",
          correction: "la casa",
          category: "pronunciation",
          explanation: "the final vowel",
          severity: "medium",
          startMs: 0,
          endMs: 500,
        },
      ],
    });
    return (db.prepare("SELECT id FROM findings").get() as { id: string }).id;
  }

  it("counts the reduced loop as a visit ONLY when the line can never be played", () => {
    // The fixture states the three situations and what each must allow.
    expect(drillGate({ heard: false, renditionUnavailable: false, renditionImpossible: true })).toEqual({
      canRecord: true,
      visitCounts: true, // no voice here ever ⇒ the reduced loop IS the drill
    });
    expect(drillGate({ heard: false, renditionUnavailable: true, renditionImpossible: false })).toEqual({
      canRecord: true,
      visitCounts: false, // a FAILED render may succeed later — keep waiting for it
    });
    expect(drillGate({ heard: true, renditionUnavailable: false, renditionImpossible: false })).toEqual({
      canRecord: true,
      visitCounts: true,
    });
  });

  it("the finding leaves the daily plan once that loop is recorded", async () => {
    const db = freshDb();
    const findingId = seedDrill(db);
    const { compose, capsFromSettings } = await import("@/lib/compose");
    const { recordVisit } = await import("@/lib/pronunciation/attempts");
    const { drillKeyForFinding } = await import("@/lib/pronunciation/types");

    // Before: the pronunciation finding is on the plan. It has no card path, so a visit is
    // its ONLY retirement route — which is why it looped forever when a visit was
    // unreachable without a key.
    const planned = () =>
      compose(db, "2026-07-25", capsFromSettings(db))
        .items.filter((i) => i.kind === "finding")
        .map((i) => i.ref);
    expect(planned()).toContain(findingId);

    recordVisit(db, { drillKey: drillKeyForFinding(findingId), findingId });
    expect(getVisit(db, drillKeyForFinding(findingId))?.cycles).toBe(1);
    expect(planned()).not.toContain(findingId);
    db.close();
  });
});
