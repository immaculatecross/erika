import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { enqueueAnalysis, getAnalysisJob } from "@/lib/analysis/cascade";
import { getJob } from "@/lib/ingest/pipeline";
import { listSegments } from "@/lib/segments";
import { segmentPath } from "@/lib/audio-storage";
import { analysisUnavailableMessage, REQUIRED_KEY } from "@/lib/env-file";
import { cleanup, workspace, type Part, type Workspace } from "./fixtures";

// RETRO-004 §DE-1, the cold-start gate. The defect was not in a function — it was in
// the PROCESS: `npm run worker` exited 1 without an OPENAI_API_KEY, so a keyless
// install could never ingest anything, and the app's own instruction ("start the
// worker with `npm run worker`") was a closed loop. So this test drives the ACTUAL
// worker path: it spawns `scripts/worker.ts` as a real child process with the key
// scrubbed from its environment, exactly as a new user's terminal would, and asserts
// the queue drains.
//
// ─────────────────────────────────────────────────────────────────────────────
// A COLD-START TEST CONSTRUCTS THE COLD START; IT NEVER INHERITS THE HOST'S.
// [E-42 criterion 11]
//
// This file used to spawn the worker with `cwd: process.cwd()` — the repo root — and
// deleting `OPENAI_API_KEY` from the child's env achieved nothing there, because the
// worker's FIRST action is `loadEnvLocal()`, which reads `.env.local` out of its
// working directory. So on any machine configured to actually run this product, the
// "keyless" worker booted WITH a key: both assertions in the second test were
// inverted, and the run made a live, billed OpenAI call to discover it.
//
// The isolation is therefore structural, not an env-var deletion:
//   * the child's cwd is a temp directory that has no `.env.local` and never can;
//   * `tsx` is invoked by absolute path from node_modules/.bin, since `npx` would
//     resolve from that cwd, and `scripts/worker.ts`'s own imports are relative to
//     the script file, so module resolution is unaffected;
//   * `ERIKA_NO_ENV_FILE=1` is an explicit opt-out the worker honours, so the
//     guarantee survives even if some future caller passes a different cwd;
//   * and a network sensor (`tests/fixtures/no-network.cjs`, loaded with `--require`)
//     records every socket, DNS lookup, request and fetch the process attempts. The
//     keyless path must perform NO network call at all — asserted, not assumed.
//
// The sensor is itself proved to work by the last test in this file, which runs the
// same preload against a process that deliberately opens a connection and asserts
// the log is NOT empty. A sensor that could not detect anything would make every
// "no network" assertion here vacuous, which is the one defect worse than none.
//
// Everything lives in an OS temp dir under ERIKA_DATA_DIR/ERIKA_DB_PATH — never data/.

const SLOW = 180_000;
const REPO = process.cwd();
const WORKER = path.join(REPO, "scripts", "worker.ts");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const NO_NETWORK = path.join(REPO, "tests", "fixtures", "no-network.cjs");
const TAKE: Part[] = [
  { kind: "tone", seconds: 3 },
  { kind: "silence", seconds: 3 },
  { kind: "tone", seconds: 3 },
];

let ws: Workspace;
const scratch: string[] = [];
afterEach(() => {
  if (ws) cleanup(ws);
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function scratchDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(d);
  return d;
}

/**
 * Copy the sensor into `dir` and return `NODE_OPTIONS` that preloads it.
 *
 * It is COPIED rather than referenced in place because `NODE_OPTIONS` is parsed as a
 * space-separated list, and this repository's own checkout path contains spaces
 * ("Murder she wrote"), which silently mangled the `--require` argument and made the
 * child exit 1 before running a line of the worker. A temp dir has no spaces, so the
 * preload path is unambiguous wherever the repo happens to live.
 */
function preloadIn(dir: string): string {
  const copy = path.join(dir, "no-network.cjs");
  fs.copyFileSync(NO_NETWORK, copy);
  return `${process.env.NODE_OPTIONS ?? ""} --require ${copy}`.trim();
}

interface Run {
  status: number | null;
  stderr: string;
  /** Every network attempt the sensor recorded, one per line. */
  network: string[];
}

/** Run the real worker to queue-exhaustion in a constructed cold start. */
function runWorkerKeyless(dir: string): Run {
  // A working directory with NO `.env.local` — the cold start, built rather than
  // hoped for. It is deliberately not the data dir, so nothing the worker writes can
  // ever put a secrets file next to itself.
  const cwd = scratchDir("erika-coldstart-cwd-");
  const netLog = path.join(cwd, "network.log");

  const env = { ...process.env };
  delete env[REQUIRED_KEY]; // the cold-start condition, verbatim
  env.ERIKA_DATA_DIR = dir;
  env.ERIKA_DB_PATH = path.join(dir, "erika.db");
  env.ERIKA_WORKER_ONCE = "1"; // drain both queues, then exit
  env.ERIKA_NO_ENV_FILE = "1"; // belt to the cwd's braces
  env.ERIKA_NETWORK_LOG = netLog;
  env.NODE_OPTIONS = preloadIn(cwd);

  const r = spawnSync(TSX, [WORKER], {
    cwd,
    env,
    encoding: "utf8",
    timeout: SLOW - 20_000,
  });
  const network = fs.existsSync(netLog)
    ? fs.readFileSync(netLog, "utf8").split("\n").filter(Boolean)
    : [];
  return { status: r.status, stderr: `${r.stderr ?? ""}`, network };
}

/** Network attempts that actually left the machine (a unix socket did not). */
const offMachine = (lines: string[]) => lines.filter((l) => !l.startsWith("UNIX "));

describe("cold start with no API key — the worker drains ingest (RETRO-004 §DE-1)", () => {
  it("constructs its cold start: no .env.local is reachable from the worker's cwd", () => {
    // The premise, asserted rather than assumed. If this ever fails, every "keyless"
    // claim below is about a keyed worker — which is exactly what used to happen.
    const cwd = scratchDir("erika-coldstart-premise-");
    expect(fs.existsSync(path.join(cwd, ".env.local"))).toBe(false);
    // And the guarantee does not depend on the HOST being keyless: this test is
    // required to pass on a configured machine too, which is the whole point.
    expect(fs.existsSync(TSX)).toBe(true);
  });

  it("an uploaded take reaches a completed ingest with segments, driven by the real worker", async () => {
    ws = workspace();
    const { sessionId, jobId } = ws.seed(TAKE);
    // The state a new user is left in: a queued job and nothing else.
    expect(getJob(ws.db, jobId)!.state).toBe("queued");
    expect(listSegments(ws.db, sessionId)).toHaveLength(0);

    const run = runWorkerKeyless(ws.dir);

    // 1. The worker did not refuse to start. (It exited 1 here before this fix, with
    //    the queue untouched — the entire defect, in one assertion.)
    expect(run.status, run.stderr).toBe(0);
    // 2. It said what is true: ingest runs, analysis does not.
    expect(run.stderr).toMatch(/ingest will run normally/i);
    expect(run.stderr).toMatch(/analysis is unavailable/i);
    expect(run.stderr).toMatch(/analysis=unavailable \(no key\)/);

    // 3. The learner has their session: ingest DONE, not stuck at "Queued 0%".
    const reread = openDatabase(path.join(ws.dir, "erika.db"));
    const job = getJob(reread, jobId)!;
    expect(job.state).toBe("done");
    expect(job.progress).toBe(1);
    // 4. …with real speech extracted — the two tones, the silence discarded.
    const segments = listSegments(reread, sessionId);
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) {
      expect(s.durationMs).toBeGreaterThan(0);
      // The audio they can actually play back, on disk under the temp data dir.
      expect(fs.existsSync(segmentPath(sessionId, s.idx))).toBe(true);
    }
    reread.close();

    // 5. [criterion 11] And it reached NO network at all. Speech extraction is
    //    ffmpeg and hashing — zero model calls — so a keyless ingest that phoned
    //    anywhere would mean a billed call nobody asked for.
    expect(offMachine(run.network)).toEqual([]);
  }, SLOW);

  it("an analysis job fails honestly and terminally, and the worker keeps working", async () => {
    ws = workspace();
    const first = ws.seed(TAKE);
    runWorkerKeyless(ws.dir); // ingest the first take so analysis has segments

    const reread = openDatabase(path.join(ws.dir, "erika.db"));
    expect(listSegments(reread, first.sessionId).length).toBeGreaterThan(0);
    const analysisId = enqueueAnalysis(reread, first.sessionId).id;
    reread.close();

    // Queue a SECOND ingest alongside the doomed analysis job: the refusal must not
    // stop the worker or block other work.
    const second = ws.seed(TAKE);

    const run = runWorkerKeyless(ws.dir);
    expect(run.status).toBe(0); // the process survived the refusal

    const after = openDatabase(path.join(ws.dir, "erika.db"));
    const analysis = getAnalysisJob(after, analysisId)!;
    // Terminal for THIS job, with the truth and the fix in the message.
    expect(analysis.state).toBe("failed");
    expect(analysis.error).toBe(analysisUnavailableMessage());
    expect(analysis.error).toContain(REQUIRED_KEY);
    // Never "right now": the condition is permanent until the user acts (§DE-3).
    expect(analysis.error).not.toMatch(/right now/i);

    // [criterion 11] THE REFUSAL COST NOTHING. The job was refused at the point a
    // model call would have been needed, so the process never opened a connection —
    // which is precisely what the old `cwd: process.cwd()` version could not claim,
    // because on a configured machine it made the call and then asserted about it.
    expect(offMachine(run.network)).toEqual([]);

    // Not a retry loop: `failed` is claimed by neither the queued claim nor the stale
    // reclaim, so a further worker run leaves it exactly where it is.
    const secondRun = runWorkerKeyless(ws.dir);
    expect(secondRun.status).toBe(0);
    expect(offMachine(secondRun.network)).toEqual([]);

    // And the other work went through.
    const after2 = openDatabase(path.join(ws.dir, "erika.db"));
    expect(getJob(after2, second.jobId)!.state).toBe("done");
    expect(listSegments(after2, second.sessionId).length).toBeGreaterThan(0);
    const stillFailed = getAnalysisJob(after2, analysisId)!;
    expect(stillFailed.state).toBe("failed");
    after.close();
    after2.close();
  }, SLOW);
});

describe("the network sensor can actually fail", () => {
  // Without this, `expect(run.network).toEqual([])` above would pass just as happily
  // against a preload that recorded nothing — a test that cannot fail, which v0.6
  // shipped four of. So: run the SAME preload against a process that deliberately
  // reaches out, and require the log to catch it.
  it("records an outbound connection attempt, so an empty log is real evidence", () => {
    const cwd = scratchDir("erika-sensor-");
    fs.copyFileSync(NO_NETWORK, path.join(cwd, "no-network.cjs"));
    const netLog = path.join(cwd, "network.log");
    const probe = path.join(cwd, "probe.cjs");
    // Connects to a port nothing is listening on, on the loopback address: no bytes
    // leave the machine and nothing can hang, but `net.Socket.connect` is genuinely
    // called — which is the exact call the sensor claims to see.
    fs.writeFileSync(
      probe,
      [
        'const net = require("node:net");',
        'const s = net.connect({ host: "127.0.0.1", port: 9 });',
        's.on("error", () => process.exit(0));',
        's.on("connect", () => { s.destroy(); process.exit(0); });',
        "setTimeout(() => process.exit(0), 2000);",
      ].join("\n"),
    );
    const r = spawnSync(process.execPath, ["--require", path.join(cwd, "no-network.cjs"), probe], {
      cwd,
      env: { ...process.env, ERIKA_NETWORK_LOG: netLog, NODE_OPTIONS: "" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const lines = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").split("\n").filter(Boolean) : [];
    expect(offMachine(lines).length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("127.0.0.1:9");
  }, 30_000);
});
