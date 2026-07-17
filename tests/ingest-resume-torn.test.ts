import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ffmpeg from "@/lib/ingest/ffmpeg";
import { processJob } from "@/lib/ingest/pipeline";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { listSegments } from "@/lib/segments";
import { cleanup, workspace, type Part, type Workspace } from "./fixtures";

// Regression: crash-resume must never trust a torn on-disk artifact (harm class
// "silent wrong result"). A worker killed mid-ffmpeg-write leaves a valid-header
// but TRUNCATED file; before the atomic-write fix the pipeline accepted such a
// file as a finished normalization / cache rendition and produced the wrong
// result while reporting state=done. We simulate the kill by writing the real
// (full) output, byte-truncating it in place, then throwing — exactly the torn
// artifact ffprobe reads as 16 kHz mono / short (verified empirically). These
// tests fail against the pre-fix code (file-existence/probe-ability skip) and
// pass once each ffmpeg output is written temp-file + atomic-rename, so a partial
// file can never be observed at the skip/cache path.

const SLOW = 120_000;
let ws: Workspace;

// The genuine ffmpeg — captured before the spy replaces the export.
const realRunFfmpeg = ffmpeg.runFfmpeg;

afterEach(() => {
  vi.restoreAllMocks();
  if (ws) cleanup(ws);
});

/** Truncate a file to `frac` of its bytes: a valid WAV header, torn body. */
function tearFile(p: string, frac = 0.4): void {
  const size = fs.statSync(p).size;
  fs.truncateSync(p, Math.max(64, Math.floor(size * frac)));
}

/**
 * A `runFfmpeg` that models a worker killed mid-write: it lets the real ffmpeg
 * produce the full output at whatever path the code chose (the last arg — the
 * temp path after the fix, the destination before it), tears that file to a
 * truncated-but-probeable remnant, then throws as if the process died.
 */
async function crashMidWrite(args: string[]): Promise<string> {
  const out = args[args.length - 1];
  await realRunFfmpeg(args);
  tearFile(out);
  throw new Error("simulated SIGKILL: worker died mid-ffmpeg-write");
}

/** True for the atempo render invocation — used to crash only that ffmpeg call. */
function isRenderCall(args: string[]): boolean {
  return args.some((a) => typeof a === "string" && a.includes("atempo="));
}

// Three well-separated speech intervals (15 s). Full ⇒ 3 kept segments; a
// normalized file torn to ~40% holds only the first tone ⇒ 1 segment — the sharp
// signal that a torn normalize was wrongly accepted.
const THREE_SPEECH: Part[] = [
  { kind: "tone", seconds: 3, freq: 440 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 3, freq: 660 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 3, freq: 880 },
];

const TWO_THREE_FOUR: Part[] = [
  { kind: "tone", seconds: 2 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 4 },
];

describe("crash-resume never trusts a torn artifact", () => {
  it("torn normalized.wav on resume is re-normalized, not skipped", async () => {
    ws = workspace();
    const { jobId, sessionId } = ws.seed(THREE_SPEECH);

    // Kill the worker mid-normalize: a valid-header 16 kHz mono file lands, but
    // truncated. Pre-fix it lands at normalized.wav and is later probed-and-
    // skipped; post-fix it lands at a temp path that resume ignores.
    vi.spyOn(ffmpeg, "runFfmpeg").mockImplementationOnce(crashMidWrite);
    const crashed = await processJob(ws.db, jobId);
    expect(crashed.state).toBe("failed"); // the crash fired

    // Resume with real ffmpeg. If the torn normalize were trusted, detection sees
    // only the first ~6 s ⇒ 1 segment; a correct re-normalize yields all three.
    const done = await processJob(ws.db, jobId);
    expect(done.state).toBe("done");
    expect(listSegments(ws.db, sessionId)).toHaveLength(3);
  }, SLOW);

  it("torn cache rendition is re-rendered, not served as a hit", async () => {
    ws = workspace();
    const a = ws.seed(TWO_THREE_FOUR);

    // Real run up to the rendering boundary: normalize + both segments on disk.
    const staged = await processJob(ws.db, a.jobId, { stopAfter: "segmenting" });
    expect(staged.stage).toBe("rendering");
    const hash0 = listSegments(ws.db, a.sessionId)[0].contentHash;
    const cachePath = renditionCachePath(hash0, 1.5);

    // Kill the worker mid-render of the first segment: the shared cache entry is
    // torn. Resume recomputes detection (a silencedetect ffmpeg call) before
    // rendering, so we crash only the atempo call — the real render write. Pre-fix
    // the torn file lands at cachePath (a permanent, cross-session hit); post-fix
    // it lands at a temp path and cachePath stays absent.
    const spy = vi.spyOn(ffmpeg, "runFfmpeg").mockImplementation((args) =>
      isRenderCall(args) ? crashMidWrite(args) : realRunFfmpeg(args),
    );
    const crashed = await processJob(ws.db, a.jobId);
    expect(crashed.state).toBe("failed");
    spy.mockRestore(); // the second session renders for real

    // A second, identical session shares the content hash (D-10). If the torn
    // rendition were a valid cache hit it would be reused at the wrong (short)
    // duration; a correct re-render matches segment_duration / tempo.
    const b = ws.seed(TWO_THREE_FOUR);
    const bd = await processJob(ws.db, b.jobId);
    expect(bd.state).toBe("done");

    const seg0 = listSegments(ws.db, b.sessionId)[0];
    expect(seg0.contentHash).toBe(hash0); // same audio ⇒ same cache key
    const segDur = await ffmpeg.probeDuration(segmentPath(b.sessionId, seg0.idx));
    const rendDur = await ffmpeg.probeDuration(cachePath);
    expect(rendDur).toBeCloseTo(segDur / 1.5, 1); // whole rendition, not a torn remnant
  }, SLOW);
});
