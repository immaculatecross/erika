import { UPLOAD_FORMAT, recordingFilename } from "../recording";
import type { UploadResult } from "../upload-audio";

// Landing a conversation as a NORMAL session (E-43 criterion 5, E-17).
//
// The conversation is recorded client-side and goes up the SAME capture→ingest path as
// any other take, so its findings come from one channel and nothing about the tutor is
// a second source of truth.
//
// ⚠️ THE CONVERSION IS THE WHOLE POINT OF THIS MODULE. A live MediaRecorder blob has
// no container duration, so the server's ffprobe cannot read one and the finalize gate
// answers **422 undecodable_audio**. The tutor uploaded its raw WebM for two versions
// and every conversation was refused at the door — criterion 5 was false while the
// suite was green, because no unit test uploads a real MediaRecorder blob. Driving the
// built app in a browser is what found it, which is the E-37 lesson exactly: reading
// finds wrong logic, driving finds features that do not exist.
//
// Everything the browser supplies is INJECTED, so the sequencing, the naming and the
// failure branches are testable in Node with no DOM and no network.

export interface LandTakeDeps {
  /** The assembled recording, or null when nothing was captured. */
  blob: Blob | null;
  /** The instant the conversation began — `sessions.captured_at` (E-42's v28 column),
   *  and the key the server links this recording to its conversation by. */
  capturedAt: Date;
  /** Decode the container and re-encode as WAV (lib/recording.ts `toUploadableWav`). */
  toWav: (blob: Blob) => Promise<Blob>;
  /** The one client-side ingestion path (lib/upload-audio.ts `uploadAudio`). */
  upload: (filename: string, body: Blob, capture: { capturedAt?: string }) => Promise<UploadResult>;
}

export type LandTakeOutcome =
  | { kind: "uploaded" }
  | { kind: "empty" }
  | { kind: "lost"; message: string }
  | { kind: "refused"; message: string };

/** What the learner is told when the take could not be turned into a file. Losing
 *  audio silently is the worst failure this app can have (the E-16b rule). */
export const CONVERSATION_TAKE_LOST =
  "That conversation was not saved as a recording, so it will not become findings. Everything else about it counted.";

/**
 * Convert, name and upload the conversation's take. Never throws: a conversation that
 * cannot be uploaded must still finalize its money and close its record, so every
 * failure comes back as a value the caller can say out loud.
 */
export async function landConversationTake(deps: LandTakeDeps): Promise<LandTakeOutcome> {
  const { blob, capturedAt } = deps;
  if (!blob || blob.size === 0) return { kind: "empty" };

  let wav: Blob;
  try {
    wav = await deps.toWav(blob);
  } catch {
    return { kind: "lost", message: CONVERSATION_TAKE_LOST };
  }
  if (wav.size === 0) return { kind: "lost", message: CONVERSATION_TAKE_LOST };

  try {
    const result = await deps.upload(recordingFilename(UPLOAD_FORMAT, capturedAt), wav, {
      capturedAt: capturedAt.toISOString(),
    });
    return result.ok ? { kind: "uploaded" } : { kind: "refused", message: result.message };
  } catch {
    return { kind: "refused", message: CONVERSATION_TAKE_LOST };
  }
}
