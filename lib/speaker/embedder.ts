// The speaker-embedding SEAM (E-36, D-22), mirroring `AudioModelClient`
// (lib/analysis/audio-model.ts): the attribution stage depends on this INTERFACE
// and never imports a concrete embedder, so the whole windowing/scoring/gating
// orchestration is unit-tested against a plain mock and no test ever loads a native
// model or touches the network. The concrete implementations live beside this file:
//
//   * SpectralEmbedder (spectral-embedder.ts) — a deterministic, dependency-free
//     ffmpeg + log-mel feature that RUNS IN THE SANDBOX, so the D-13 τ calibration
//     is genuinely exercised end to end. This is the resolvable default.
//   * SherpaEmbedder (sherpa-embedder.ts) — the production sherpa-onnx speaker model
//     (CAM++/WeSpeaker class), a QUALITY UPGRADE behind this same interface. It is
//     operator-gated: the sandbox has no egress and cannot download or run the model,
//     so `isAvailable()` is false unless the operator installs the runtime + asset,
//     and the resolver falls back to the spectral embedder. Absence degrades
//     honestly — attribution is skipped — and never crashes ingest.
//
// An embedder maps a short audio window (a span of a wav file on disk) to a
// fixed-dimension vector; `cosineSimilarity` compares two. All I/O is file→file
// through ffmpeg, the pipeline's discipline everywhere — the embedder reads only a
// bounded window at a time, never a whole recording.

export interface SpeakerEmbedder {
  /** Stable id for provenance (the reference cache is keyed by it, so a different
   *  embedder recomputes rather than reusing an incompatible vector). */
  readonly id: string;
  /** Whether this embedder can actually run here (model runtime + asset present).
   *  When false the caller skips attribution and every segment stays unattributed. */
  isAvailable(): boolean;
  /** Embed one audio window — [startMs, endMs) of the wav at `wavPath` — into a
   *  fixed-length unit-normalized vector. Throws only on a genuine I/O failure; the
   *  caller treats a throw as "unattributed" (recall-first) and never fails ingest. */
  embed(wavPath: string, startMs: number, endMs: number): Promise<Float32Array>;
}

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for a
 * zero-magnitude vector (no direction to compare) or a length mismatch — a
 * conservative "no similarity" that, under recall-first, never spuriously EXCLUDES
 * the user (it lowers the score, and a below-threshold user segment stays user via
 * the max-over-windows rule only when some OTHER window scores high). The embedders
 * already return unit vectors, so this is effectively a dot product; the full
 * normalization is kept so the helper is correct for any input.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mean of several vectors into one centroid (the reference embedding). Assumes a
 *  non-empty list of equal-length vectors; returns a unit-normalized centroid so
 *  cosine against it is stable regardless of how many windows fed it. */
export function centroid(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    sum[i] /= vectors.length;
    norm += sum[i] * sum[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) sum[i] /= norm;
  }
  return sum;
}
