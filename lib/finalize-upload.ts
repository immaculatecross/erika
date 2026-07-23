import { removeSessionDir } from "@/lib/audio-storage";
import { getDb } from "@/lib/db";
import { FfprobeError, probeDurationSeconds } from "@/lib/ffprobe";
import {
  createSession,
  isSupportedFormat,
  maxDurationSeconds,
  SUPPORTED_FORMATS,
} from "@/lib/sessions";
import type { Session } from "@/lib/session-types";

// The one place a staged, on-disk recording becomes a session (E-24 criterion 5).
// Extracted from the streamed POST so the tus completion hook finalizes through
// the exact same gate: format check → probe (the real decodability test) →
// duration-cap check → createSession (the single insert of a session + its one
// `queued` ingest job, lib/sessions.ts). Same bytes in, same observable end
// state out, whichever path delivered them.
//
// Every rejection removes the session directory and throws UploadRejected. The
// caller is responsible for removing ITS OWN staging artifact too (the streamed
// path already streamed straight into the session dir; the tus path must drop
// the tus upload), so a rejected upload leaves neither file nor row.

/** A staged upload rejected by the finalize gate — carries the API error shape. */
export class UploadRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadRejected";
  }
}

export interface FinalizeInput {
  /** The session id — files are already staged under it. */
  id: string;
  /** The user-facing original filename, recorded on the session row. */
  filename: string;
  /** The lowercase extension/format; validated here again for the tus path. */
  format: string;
  /** Absolute path of the staged source bytes, i.e. sourcePath(id, format). */
  sourceFile: string;
  /** Exact byte count already written to `sourceFile`. */
  sizeBytes: number;
}

/**
 * Finalize a staged upload into a session, or reject it and clean up. Throws
 * UploadRejected (unsupported format / empty / undecodable / over the duration
 * cap) after removing the session directory; on success returns the created
 * session with its queued ingest job.
 */
export async function finalizeStagedUpload(input: FinalizeInput): Promise<Session> {
  const { id, filename, format, sourceFile, sizeBytes } = input;

  if (!isSupportedFormat(format)) {
    await removeSessionDir(id);
    throw new UploadRejected(
      "unsupported_format",
      `Unsupported format. Accepted: ${SUPPORTED_FORMATS.join(", ")}.`,
      415,
    );
  }

  if (sizeBytes === 0) {
    await removeSessionDir(id);
    throw new UploadRejected("empty_upload", "The uploaded file is empty.", 400);
  }

  let durationSeconds: number;
  try {
    durationSeconds = await probeDurationSeconds(sourceFile);
  } catch (err) {
    await removeSessionDir(id);
    if (err instanceof FfprobeError) throw new UploadRejected("undecodable_audio", err.message, 422);
    throw err;
  }

  if (durationSeconds > maxDurationSeconds()) {
    await removeSessionDir(id);
    throw new UploadRejected(
      "too_long",
      `Audio is longer than the ${maxDurationSeconds()}-second (24 h) limit.`,
      413,
    );
  }

  return createSession(getDb(), {
    id,
    originalFilename: filename,
    format,
    sizeBytes,
    durationSeconds,
  });
}
