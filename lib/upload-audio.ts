import * as tus from "tus-js-client";
import {
  CAPTURED_AT_HEADER,
  CAPTURED_AT_HINT_HEADER,
  CAPTURED_AT_HINT_KEY,
  CAPTURED_AT_KEY,
} from "./capture-time";

// The one client-side path to ingestion (E-2's fixed contract, E-24's upgrade).
// Both the file picker and the mic recorder funnel through uploadAudio, so the
// upload contract lives in exactly one place.
//
// Primary path: the tus resumable protocol (POST to /api/upload), so a dropped
// connection on a big day-dump resumes from its offset instead of restarting.
// Fallback path: the original streamed raw-body POST /api/sessions (x-filename
// header, never multipart) — used automatically when tus is unsupported or its
// endpoint fails at the protocol level. A definitive rejection of the file
// itself (unsupported format, too large, undecodable, over the duration cap) is
// surfaced truthfully and NOT retried through the fallback.

export type UploadResult = { ok: true } | { ok: false; message: string };

/** 4xx statuses the finalize gate uses to reject the file itself (not retried). */
const REJECTION_STATUSES = new Set([400, 413, 415, 422]);

const GENERIC_FAILURE = "Upload failed.";

/**
 * What the client knows about when the audio was CAPTURED (E-42 criterion 5).
 * Both transports carry these under the same two names, so the server's finalize
 * gate sees identical inputs whichever one delivered the bytes.
 */
export interface CaptureMeta {
  /** ISO-8601 instant the mic take STARTED — the authoritative source. */
  capturedAt?: string;
  /** ISO-8601 modification time of a picked file — a weaker hint. */
  capturedAtHint?: string;
}

export async function uploadAudio(
  filename: string,
  body: BodyInit,
  capture: CaptureMeta = {},
): Promise<UploadResult> {
  if (tus.isSupported) {
    const viaTus = await uploadViaTus(filename, body as Blob, capture);
    // A resolved result (success, or a definitive file rejection) is final; a
    // null means the tus transport failed and the streamed fallback should try.
    if (viaTus) return viaTus;
  }
  return uploadStreamed(filename, body, capture);
}

/** Drop absent values so a transport never sends an empty capture claim. */
function definedEntries(record: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

/**
 * Attempt the resumable upload. Resolves to a final UploadResult when the upload
 * succeeds or the server definitively rejects the file; resolves to null when
 * the tus transport itself failed, so the caller falls back to the streamed POST.
 */
function uploadViaTus(
  filename: string,
  body: Blob,
  capture: CaptureMeta,
): Promise<UploadResult | null> {
  return new Promise((resolve) => {
    const upload = new tus.Upload(body, {
      endpoint: "/api/upload",
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      metadata: definedEntries({
        filename,
        [CAPTURED_AT_KEY]: capture.capturedAt,
        [CAPTURED_AT_HINT_KEY]: capture.capturedAtHint,
      }),
      onError(error) {
        const status = tusErrorStatus(error);
        if (status !== null && REJECTION_STATUSES.has(status)) {
          resolve({ ok: false, message: tusErrorMessage(error) });
        } else {
          resolve(null); // transport failure — fall back to the streamed POST
        }
      },
      onSuccess() {
        resolve({ ok: true });
      },
    });
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => resolve(null));
  });
}

/** The original streamed upload, kept as the automatic fallback. */
async function uploadStreamed(
  filename: string,
  body: BodyInit,
  capture: CaptureMeta,
): Promise<UploadResult> {
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: definedEntries({
        "x-filename": encodeURIComponent(filename),
        [CAPTURED_AT_HEADER]: capture.capturedAt,
        [CAPTURED_AT_HINT_HEADER]: capture.capturedAtHint,
      }),
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: errorMessageOf(data) ?? GENERIC_FAILURE };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_FAILURE };
  }
}

/** The HTTP status behind a tus error, or null when it was not an HTTP error. */
function tusErrorStatus(error: unknown): number | null {
  const res = (error as { originalResponse?: { getStatus?: () => number } })?.originalResponse;
  const status = res?.getStatus?.();
  return typeof status === "number" ? status : null;
}

/** The server's truthful message for a rejected upload, or a quiet fallback. */
function tusErrorMessage(error: unknown): string {
  const res = (error as { originalResponse?: { getBody?: () => string } })?.originalResponse;
  const body = res?.getBody?.();
  if (body) {
    const parsed = safeParse(body);
    const message = parsed ? errorMessageOf(parsed) : body.trim();
    if (message) return message;
  }
  return GENERIC_FAILURE;
}

/** Pull a message out of either envelope: {error:{code,message}} or {error:"…"}. */
function errorMessageOf(data: unknown): string | null {
  const err = (data as { error?: unknown })?.error;
  if (typeof err === "string") return err;
  const message = (err as { message?: unknown })?.message;
  return typeof message === "string" ? message : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
