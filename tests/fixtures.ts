import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "@/lib/db";
import { createSession } from "@/lib/sessions";

// Synthetic ingest fixtures. Following the repo's E-2 convention (tests/helpers
// makeWav), we generate real, decodable audio with the system ffmpeg at test
// time rather than committing binaries: sine tones separated by anullsrc
// silence, at 44.1 kHz so the pipeline genuinely resamples to 16 kHz. Never real
// audio, never anything under data/ — everything lands in an OS temp dir.

export interface Part {
  kind: "tone" | "silence";
  seconds: number;
  freq?: number;
}

const SOURCE_RATE = 44100;

/** Build a WAV at `dest` from a tone/silence timeline. Returns its byte size. */
export function buildFixture(dest: string, parts: Part[]): number {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  parts.forEach((p, i) => {
    if (p.kind === "tone") {
      inputs.push("-f", "lavfi", "-i", `sine=frequency=${p.freq ?? 440}:duration=${p.seconds}`);
    } else {
      inputs.push("-f", "lavfi", "-i", `anullsrc=r=${SOURCE_RATE}:cl=mono:d=${p.seconds}`);
    }
    filters.push(`[${i}:a]atrim=0:${p.seconds},aformat=sample_rates=${SOURCE_RATE}:channel_layouts=mono[l${i}]`);
    labels.push(`[l${i}]`);
  });
  const filter = `${filters.join(";")};${labels.join("")}concat=n=${parts.length}:v=0:a=1[out]`;
  execFileSync(
    "ffmpeg",
    ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-ar", String(SOURCE_RATE), "-c:a", "pcm_s16le", dest],
    { stdio: "ignore" },
  );
  return fs.statSync(dest).size;
}

/** A temp workspace with its own data dir + db, wired so audio-storage resolves there. */
export interface Workspace {
  dir: string;
  db: ReturnType<typeof openDatabase>;
  /** Stage a source file for a session and insert its queued job; returns ids. */
  seed: (parts: Part[]) => { sessionId: string; jobId: string };
  seedRaw: (bytes: Buffer) => { sessionId: string; jobId: string };
}

export function workspace(): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-ingest-"));
  process.env.ERIKA_DATA_DIR = dir;
  const db = openDatabase(path.join(dir, "erika.db"));
  let n = 0;

  function insert(sessionId: string, bytes: number): void {
    createSession(db, {
      id: sessionId,
      originalFilename: "take.wav",
      format: "wav",
      sizeBytes: bytes,
      durationSeconds: 1,
    });
  }

  function jobId(sessionId: string): string {
    return (db.prepare("SELECT id FROM ingest_jobs WHERE session_id = ?").get(sessionId) as { id: string }).id;
  }

  return {
    dir,
    db,
    seed(parts) {
      const sessionId = `s${n++}`;
      const src = path.join(dir, "sessions", sessionId, "source.wav");
      const bytes = buildFixture(src, parts);
      insert(sessionId, bytes);
      return { sessionId, jobId: jobId(sessionId) };
    },
    seedRaw(bytes) {
      const sessionId = `s${n++}`;
      const src = path.join(dir, "sessions", sessionId, "source.wav");
      fs.mkdirSync(path.dirname(src), { recursive: true });
      fs.writeFileSync(src, bytes);
      insert(sessionId, bytes.length);
      return { sessionId, jobId: jobId(sessionId) };
    },
  };
}

/** Tear down a workspace: close db, unset the env override, remove the dir. */
export function cleanup(ws: Workspace): void {
  ws.db.close();
  delete process.env.ERIKA_DATA_DIR;
  fs.rmSync(ws.dir, { recursive: true, force: true });
}
