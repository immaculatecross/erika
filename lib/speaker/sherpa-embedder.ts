import fs from "node:fs";
import { createRequire } from "node:module";
import type { SpeakerEmbedder } from "./embedder";
import { speakerAssetPath } from "./asset-path";
import { readWindowSamples, EMBED_SAMPLE_RATE } from "./pcm";

// The PRODUCTION speaker embedder (E-36, D-22): a local sherpa-onnx speaker model
// (CAM++/WeSpeaker class, ~29 MB .onnx). It is a QUALITY UPGRADE behind the shared
// `SpeakerEmbedder` interface, and it is entirely OPERATOR-GATED — the honest wall
// the WO names:
//
//   * The model asset is NOT committed (a large binary; criterion 7). The operator
//     drops it at ERIKA_SPEAKER_MODEL, or at lib/speaker/models/campplus.onnx (which
//     next.config traces into a standalone build via the #47-safe asset discipline).
//   * The `sherpa-onnx-node` runtime is NOT a committed dependency: the sandbox has
//     no egress to install it, and adding it to package.json would break `npm ci` in
//     CI against the unchanged lockfile. So it is loaded by a fully DYNAMIC import
//     (a non-literal specifier, so typecheck/webpack never try to resolve it) that a
//     real deployment satisfies with `npm install sherpa-onnx-node`.
//
// `isAvailable()` is therefore false in the sandbox and the resolver falls back to
// the spectral embedder. Absence degrades honestly — attribution is skipped, ingest
// never crashes. Live τ re-calibration against this model is an operator-gated
// follow-up (D-19: we do not oversell an unrun path).

// Typed as `string` (not the literal), so `import(RUNTIME_MODULE)` and
// `require.resolve(RUNTIME_MODULE)` are treated as DYNAMIC — TypeScript never tries
// to resolve the absent package and typecheck/build stay green without it installed.
const RUNTIME_MODULE: string = "sherpa-onnx-node";
const DEFAULT_MODEL_REL = "lib/speaker/models/campplus.onnx";

/** The configured model path (env override, else the traced default). */
export function sherpaModelPath(): string {
  return process.env.ERIKA_SPEAKER_MODEL ?? speakerAssetPath(DEFAULT_MODEL_REL);
}

/** Whether the sherpa runtime module can be resolved here. Kept cheap and safe. */
function runtimeInstalled(): boolean {
  try {
    // require.resolve on a variable specifier is true only if the package is actually
    // installed. Never throws out — a missing module is simply "not installed".
    createRequire(import.meta.url).resolve(RUNTIME_MODULE);
    return true;
  } catch {
    return false;
  }
}

interface SherpaExtractor {
  compute(samples: Float32Array, sampleRate: number): Float32Array | number[];
}

/**
 * Build the sherpa-onnx speaker embedder, or null if the runtime or the model asset
 * is absent (the sandbox case). Async because loading the native module + model is
 * async; the resolver awaits it once at worker startup.
 */
export async function createSherpaEmbedder(): Promise<SpeakerEmbedder | null> {
  const modelPath = sherpaModelPath();
  if (!runtimeInstalled() || !fs.existsSync(modelPath)) return null;
  let extractor: SherpaExtractor;
  try {
    // Non-literal specifier ⇒ TypeScript types it `any` and webpack leaves it alone
    // (never bundled), so this file typechecks and builds with the package absent.
    const mod: unknown = await import(/* webpackIgnore: true */ RUNTIME_MODULE);
    const sherpa = mod as {
      SpeakerEmbeddingExtractor: new (config: unknown) => SherpaExtractor;
    };
    extractor = new sherpa.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 1 });
  } catch {
    return null; // any load failure degrades honestly to "unavailable"
  }
  return {
    id: "sherpa-onnx-campplus",
    isAvailable() {
      return true;
    },
    async embed(wavPath, startMs, endMs) {
      const samples = await readWindowSamples(wavPath, startMs, endMs, EMBED_SAMPLE_RATE);
      const vec = extractor.compute(samples, EMBED_SAMPLE_RATE);
      return vec instanceof Float32Array ? vec : Float32Array.from(vec);
    },
  };
}
