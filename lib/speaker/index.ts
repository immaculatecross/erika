import type { SpeakerEmbedder } from "./embedder";
import { spectralEmbedder } from "./spectral-embedder";
import { createSherpaEmbedder } from "./sherpa-embedder";

// The speaker-attribution public surface (E-36). The concrete embedder is resolved
// HERE and injected into the ingest pipeline by scripts/worker.ts — exactly as
// scripts/worker.ts imports the real `openAiAudioModel` and passes it to the
// cascade, keeping the pipeline module itself free of any concrete-embedder import.

export type { SpeakerEmbedder } from "./embedder";
export { cosineSimilarity, centroid } from "./embedder";
export { spectralEmbedder } from "./spectral-embedder";
export {
  WINDOW_MS,
  WINDOW_HOP_MS,
  SPEAKER_USER_THRESHOLD,
  windowsFor,
  attributeSegment,
  type SegmentVerdict,
} from "./attribution";
export { ensureReference, type ReferenceEmbedding } from "./reference";
export { setSegmentAttribution } from "./store";

/**
 * The kill-switch (D-22): `ERIKA_SPEAKER_FILTER=off` disables attribution entirely,
 * so every segment stays unattributed (treated as the user) — the escape hatch for
 * a false-exclude regression or a debugging session. Anything else (unset included)
 * leaves the filter on.
 */
export function speakerFilterEnabled(raw: string | undefined = process.env.ERIKA_SPEAKER_FILTER): boolean {
  return (raw ?? "").trim().toLowerCase() !== "off";
}

/**
 * Resolve the best available embedder: the production sherpa-onnx model when its
 * runtime + asset are installed, else the deterministic in-sandbox spectral
 * embedder. Async because loading the native sherpa model is async. The result is a
 * plain object implementing `SpeakerEmbedder`; the pipeline never sees which one.
 */
export async function resolveEmbedder(): Promise<SpeakerEmbedder> {
  const sherpa = await createSherpaEmbedder();
  return sherpa ?? spectralEmbedder;
}
