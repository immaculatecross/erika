// Client-safe types and constants for captured sessions. No Node imports live
// here so a client component (the Sessions page) can import SUPPORTED_FORMATS
// and the Session shape without pulling the server-only data layer (node:crypto,
// better-sqlite3) into the browser bundle. lib/sessions.ts re-exports all of it.

/** The seven accepted upload formats (also used as the on-disk extension). */
export const SUPPORTED_FORMATS = ["mp3", "wav", "m4a", "webm", "ogg", "aac", "flac"] as const;
export type AudioFormat = (typeof SUPPORTED_FORMATS)[number];

/** Content types served for the audio stream, keyed by format. */
export const AUDIO_MIME: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

export function isSupportedFormat(ext: string): ext is AudioFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(ext);
}

/** Ingest-job lifecycle. E-2 part 1 only writes 'queued'; E-3 drives the rest. */
export const INGEST_STATES = ["queued", "processing", "done", "failed"] as const;
export type IngestState = (typeof INGEST_STATES)[number];

export interface Session {
  id: string;
  originalFilename: string;
  format: string;
  sizeBytes: number;
  durationSeconds: number;
  /**
   * When the ROW was made — i.e. when the upload finished. NOT when the learner
   * spoke, and never to be shown as such: Erika's capture is day-scale and async
   * (D-9), so a take recorded at 08:10 and uploaded at 21:30 differs by thirteen
   * hours. Kept because "when did this land" is a real question (E-42, v28).
   */
  createdAt: string;
  /** When the learner SPOKE (E-42, v28) — the only field any "when you recorded"
   *  claim may read. See lib/capture-time.ts for how it is resolved and why. */
  capturedAt: string;
  jobState: IngestState;
  /** The manual "this recording isn't me — don't learn from it" flag (E-36, D-22).
   *  An excluded session mints NO produced-lemma positive evidence regardless of the
   *  acoustic verdict; findings/corrections are unaffected. Defaults false. */
  excludeFromEvidence: boolean;
}
