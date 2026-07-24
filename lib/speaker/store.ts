import type { Db } from "../db";

// Server-only DB glue for E-36's persisted state: the per-segment attribution
// verdict (segments.speaker_score / is_user) and the cached reference embedding
// (speaker_references). Both are additive to tables owned elsewhere; this module is
// the one door for the speaker feature's writes.

/** Persist one segment's verdict. `isUser` is 1/0, or null for unattributed. */
export function setSegmentAttribution(
  db: Db,
  segmentId: string,
  speakerScore: number | null,
  isUser: 0 | 1 | null,
): void {
  db.prepare("UPDATE segments SET speaker_score = ?, is_user = ? WHERE id = ?").run(
    speakerScore,
    isUser,
    segmentId,
  );
}

export interface StoredReference {
  enrollmentId: string;
  embedderId: string;
  vector: Float32Array;
  windowCount: number;
}

interface ReferenceRow {
  enrollment_id: string;
  embedder_id: string;
  dim: number;
  vector: string;
  window_count: number;
}

/** The cached reference centroid for (enrollment, embedder), or null on a miss. */
export function getCachedReference(db: Db, enrollmentId: string, embedderId: string): StoredReference | null {
  const r = db
    .prepare("SELECT * FROM speaker_references WHERE enrollment_id = ? AND embedder_id = ?")
    .get(enrollmentId, embedderId) as ReferenceRow | undefined;
  if (!r) return null;
  const arr = JSON.parse(r.vector) as number[];
  return {
    enrollmentId: r.enrollment_id,
    embedderId: r.embedder_id,
    vector: Float32Array.from(arr),
    windowCount: r.window_count,
  };
}

/** Cache a reference centroid. Idempotent-on-replace so a recompute overwrites. */
export function putCachedReference(db: Db, ref: StoredReference): void {
  db.prepare(
    `INSERT INTO speaker_references (enrollment_id, embedder_id, dim, vector, window_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(enrollment_id, embedder_id)
       DO UPDATE SET dim = excluded.dim, vector = excluded.vector,
                     window_count = excluded.window_count, created_at = datetime('now')`,
  ).run(ref.enrollmentId, ref.embedderId, ref.vector.length, JSON.stringify(Array.from(ref.vector)), ref.windowCount);
}
