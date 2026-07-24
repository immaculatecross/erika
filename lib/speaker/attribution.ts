import type { SpeakerEmbedder } from "./embedder";
import { cosineSimilarity } from "./embedder";
import type { ReferenceEmbedding } from "./reference";

// Windowed, recall-first speaker attribution (E-36, D-22). A VAD segment caps at
// 4 min (lib/ingest/vad.ts MAX_SEGMENT_MS) and can therefore MIX speakers, so we do
// not score a segment whole: we score short SLIDING WINDOWS (~4 s) against the
// enrolled reference and take the MAX cosine. Max-over-windows is the recall-first
// rule — if ANY window sounds like the user, the segment counts as the user, so a
// segment the user spoke in is never dropped even when a bystander also speaks in it
// (we accept the false-include that mirror case implies; D-22 trades precision for
// recall on purpose).

/** Sliding-window length (ms). ~4 s sits in the D-22 3–5 s band. */
export const WINDOW_MS = 4000;
/** Window hop (ms) — 50% overlap, so a short user turn is not missed between windows. */
export const WINDOW_HOP_MS = 2000;

/**
 * Recall-first similarity threshold τ for the in-sandbox spectral embedder, above
 * which a window is judged the enrolled user. CALIBRATED on the committed SYNTHETIC
 * two-voice fixture (tests/fixtures/labelled-speaker — procedurally generated ffmpeg
 * formant voices, not recorded audio): every true user window there scores
 * ≥ 0.749, so τ is set BELOW that floor — the user is never dropped (user-recall
 * ≥ 0.99, D-22) — while still excluding a real fraction of the other speaker's
 * windows. This is the recall-first trade deliberately made: we accept the
 * false-includes above τ (the other-speaker windows that happen to score high)
 * rather than risk excluding the user. tests/speaker-calibration.test.ts asserts
 * this τ reaches recall ≥ 0.99 while excluding the other speaker, and that a naive
 * midpoint / accept-all baseline fails one of those.
 *
 * NOTE (D-19 honesty): this τ is calibrated for `spectral-logmel-v1` on a SYNTHETIC
 * fixture — it calibrates the METHOD, not the production operating point. The
 * production sherpa-onnx model lives in a different embedding space, so its τ must be
 * re-calibrated against a real two-voice sample on the operator's machine — an
 * operator-gated follow-up, since the sandbox cannot run the model.
 */
export const SPEAKER_USER_THRESHOLD = 0.7;

export interface WindowSpan {
  startMs: number;
  endMs: number;
}

export interface SegmentVerdict {
  /** Max cosine over the segment's windows, or null if none could be embedded. */
  speakerScore: number | null;
  /** 1 = the enrolled user, 0 = another speaker, null = unattributed. */
  isUser: 0 | 1 | null;
}

/**
 * Cover [startMs, endMs) with ~`windowMs` windows at `hopMs` hop. A span shorter
 * than one window yields a single window over the whole span, so a short segment is
 * still scored. Pure and deterministic (unit-tested).
 */
export function windowsFor(
  startMs: number,
  endMs: number,
  windowMs: number = WINDOW_MS,
  hopMs: number = WINDOW_HOP_MS,
): WindowSpan[] {
  const total = endMs - startMs;
  if (total <= 0) return [];
  if (total <= windowMs) return [{ startMs, endMs }];
  const out: WindowSpan[] = [];
  for (let s = startMs; s + windowMs <= endMs; s += hopMs) {
    out.push({ startMs: s, endMs: s + windowMs });
  }
  // Ensure the tail is covered (the last hop may stop short of the end).
  const last = out[out.length - 1];
  if (!last || last.endMs < endMs) out.push({ startMs: Math.max(startMs, endMs - windowMs), endMs });
  return out;
}

/**
 * Attribute one segment file (a wav starting at 0, of length `durationMs`) against
 * the reference. Embeds each window and returns the max similarity and the verdict.
 * A window that fails to embed is skipped; if EVERY window fails the verdict is
 * unattributed (null) — recall-first, the segment is then treated as the user.
 */
export async function attributeSegment(
  embedder: SpeakerEmbedder,
  wavPath: string,
  durationMs: number,
  reference: ReferenceEmbedding,
  threshold: number = SPEAKER_USER_THRESHOLD,
): Promise<SegmentVerdict> {
  let best: number | null = null;
  for (const w of windowsFor(0, durationMs)) {
    let vec: Float32Array;
    try {
      vec = await embedder.embed(wavPath, w.startMs, w.endMs);
    } catch {
      continue;
    }
    const sim = cosineSimilarity(vec, reference.vector);
    if (best === null || sim > best) best = sim;
  }
  if (best === null) return { speakerScore: null, isUser: null };
  return { speakerScore: best, isUser: best >= threshold ? 1 : 0 };
}
