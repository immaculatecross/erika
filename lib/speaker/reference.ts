import type { Db } from "../db";
import type { SpeakerEmbedder } from "./embedder";
import { centroid } from "./embedder";
import { latestEnrollment } from "../placement/enrollment";
import { probeDuration } from "../ingest/ffmpeg";
import { windowsFor } from "./attribution";
import { getCachedReference, putCachedReference } from "./store";

// The enrolled user's REFERENCE embedding (E-36, D-22): the centroid of the ~45 s
// enrollment take's window embeddings, computed once per (take, embedder) and cached
// in speaker_references. A re-enrollment mints a new take id (lib/placement/
// enrollment.ts), so its centroid is a cache MISS and is recomputed — the old take's
// row harmlessly lingers. The enrollment audio is read window-by-window and never
// leaves the device; only the derived vector is stored.

export interface ReferenceEmbedding {
  enrollmentId: string;
  vector: Float32Array;
  windowCount: number;
}

/**
 * The active reference for `embedder`, computing and caching it from the latest
 * enrollment take on a miss. Returns null when there is NO enrollment (attribution
 * is then skipped and every segment is treated as the user — a learner who has not
 * enrolled is never silenced) or when the take yields no usable window.
 */
export async function ensureReference(db: Db, embedder: SpeakerEmbedder): Promise<ReferenceEmbedding | null> {
  const take = latestEnrollment(db);
  if (!take) return null;

  const cached = getCachedReference(db, take.id, embedder.id);
  if (cached) {
    return { enrollmentId: cached.enrollmentId, vector: cached.vector, windowCount: cached.windowCount };
  }

  let durationMs: number;
  try {
    durationMs = Math.round((await probeDuration(take.path)) * 1000);
  } catch {
    return null; // an unreadable take degrades honestly — no reference, skip filtering
  }

  const vectors: Float32Array[] = [];
  for (const w of windowsFor(0, durationMs)) {
    try {
      vectors.push(await embedder.embed(take.path, w.startMs, w.endMs));
    } catch {
      // skip an unreadable window; the remaining ones still form a centroid
    }
  }
  if (vectors.length === 0) return null;

  const vector = centroid(vectors);
  putCachedReference(db, {
    enrollmentId: take.id,
    embedderId: embedder.id,
    vector,
    windowCount: vectors.length,
  });
  return { enrollmentId: take.id, vector, windowCount: vectors.length };
}
