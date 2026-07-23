import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Server, type Upload } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { ensureSessionDir, removeSessionDir, sourcePath } from "@/lib/audio-storage";
import { finalizeStagedUpload, UploadRejected } from "@/lib/finalize-upload";
import { getPrincipal } from "@/lib/auth/principal";
import { maxUploadBytes, newSessionId } from "@/lib/sessions";

// The tus resumable-upload server (E-24, D-25). A dropped connection on a 2 GB
// day-dump resumes from its offset instead of restarting. Partial uploads live
// under data/uploads/ (gitignored, mirrors the DB/audio root, ERIKA_DATA_DIR
// overridable); a completed upload is finalized through the SAME
// finalizeStagedUpload the streamed POST uses, so the observable end state is
// identical either way. The streamed POST /api/sessions stays as the fallback.
//
// GC policy: an incomplete upload expires TTL milliseconds after it was created
// (default 24 h, TUS_UPLOAD_TTL_MS overrides). The server advertises the expiry
// per the tus expiration extension (Upload-Expires), and a sweep
// (sweepExpiredUploads) reclaims expired partials — deleting the bytes and the
// tus metadata — while leaving in-progress uploads untouched. The sweep runs
// once when the server is first constructed (first request after boot) and can
// be re-run.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/** How long an incomplete upload survives before the sweep may reclaim it. */
function uploadTtlMs(): number {
  return Number(process.env.TUS_UPLOAD_TTL_MS ?? DEFAULT_TTL_MS);
}

/** The partial-upload store dir: data/uploads/ (never the session dirs). */
export function uploadsDir(): string {
  const root = process.env.ERIKA_DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(root, "uploads");
}

let server: Server | null = null;
let store: FileStore | null = null;

/** The FileStore backing the tus server — the raw bytes + tus metadata. */
export function getUploadStore(): FileStore {
  if (!store) {
    store = new FileStore({
      directory: uploadsDir(),
      expirationPeriodInMilliseconds: uploadTtlMs(),
    });
  }
  return store;
}

/**
 * Reclaim expired incomplete uploads: their bytes and tus metadata are removed;
 * uploads whose TTL has not passed, and completed uploads, are retained. Returns
 * how many were reclaimed. Safe to call repeatedly.
 */
export async function sweepExpiredUploads(): Promise<number> {
  return getUploadStore().deleteExpired();
}

/** Filename → lowercase extension, or "" when there is none. */
function extOf(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase();
}

// A completed tus upload is finalized here. The bytes are copied out of the tus
// store into the session directory (so finalize probes exactly the path the
// streamed path uses), finalized through the shared gate, then the tus artifact
// is dropped whatever the outcome — a rejection leaves neither file nor row, a
// success leaves exactly one session with one queued ingest job.
async function onUploadFinish(_req: Request, upload: Upload): Promise<{ status_code?: number }> {
  const filename = upload.metadata?.filename?.trim() || "recording";
  const format = extOf(filename);
  const sizeBytes = upload.size ?? upload.offset;
  const stagedPath = upload.storage?.path ?? path.join(uploadsDir(), upload.id);

  const id = newSessionId();
  try {
    await ensureSessionDir(id);
    const dest = sourcePath(id, format || "bin");
    await copyFile(stagedPath, dest);
    await finalizeStagedUpload({ id, filename, format, sourceFile: dest, sizeBytes });
  } catch (err) {
    await removeSessionDir(id).catch(() => {});
    await dropUpload(upload.id);
    if (err instanceof UploadRejected) {
      // Surface a truthful, non-2xx result to the client; no half-session remains.
      throw { status_code: err.status, body: err.message };
    }
    throw err;
  }
  await dropUpload(upload.id);
  return { status_code: 204 };
}

/** Remove a tus upload's bytes and metadata; never throws. */
async function dropUpload(id: string): Promise<void> {
  await getUploadStore()
    .remove(id)
    .catch(() => {});
}

/** The lazily-built tus Server, mounted at /api/upload. */
export function getTusServer(): Server {
  if (!server) {
    server = new Server({
      path: "/api/upload",
      datastore: getUploadStore(),
      maxSize: maxUploadBytes(),
      respectForwardedHeaders: true,
      async onUploadCreate(req, upload) {
        // The auth seam runs here too (E-40 will make it real): attribute every
        // partial upload to the resolved principal. No-op today — blocks nothing.
        const principal = getPrincipal(req as unknown as Request);
        return { metadata: { ...upload.metadata, owner: principal.id } };
      },
      onUploadFinish,
    });
    // One reclaim of anything left partial across a restart (criterion 6).
    void ensureUploadsDir().then(() => sweepExpiredUploads().catch(() => {}));
  }
  return server;
}

async function ensureUploadsDir(): Promise<void> {
  await mkdir(uploadsDir(), { recursive: true });
}
