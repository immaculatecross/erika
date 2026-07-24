import { parseAzurePaResponse } from "./azure";
import type { PronunciationScoreInput, PronunciationScorer } from "./scorer";
import type { PronunciationResult } from "./types";
import gliGnocchi from "./fixtures/it-IT-gli-gnocchi.json";
import clean from "./fixtures/it-IT-clean.json";
import noisy from "./fixtures/it-IT-noisy.json";
import omission from "./fixtures/it-IT-omission.json";

// The FIXTURE scorer (E-37). Four committed it-IT Pronunciation Assessment responses
// drive every test of the studio — the money path, the persistence, the view model,
// the knowledge writes — with ZERO egress, which is the only way this sandbox (no
// `AZURE_SPEECH_KEY`, no network) can build a new billed integration at all.
//
// **THE FIXTURES ARE SYNTHETIC AND SAY SO.** They are hand-authored to the response
// shape OBS-002 documented live on 2026-07-24 — not captured from Azure. They prove
// the parser, the bands, the SNR gate and the money path behave as specified against
// the DOCUMENTED shape; they cannot prove Azure's real numbers look like this. The
// first time an operator runs the live path, the honest move is to capture 3–5 real
// it-IT responses and replace these files (OBS-001 Part C). Each file carries that
// statement in its own `_synthetic` key, so the label travels with the data.
//
// This module is deliberately NOT wired into the app: the route resolves the live
// Azure scorer and shows the honest missing-key wall when it is unavailable. Nothing
// here can leak a fabricated score into the product (WO criterion 1).

/** The committed fixtures, by name. Each is a raw Azure-shaped response object. */
export const PRONUNCIATION_FIXTURES = {
  /** /ʎ/ produced as /l/ and /ɲ/ as /n/ — the n-best substitution story. */
  "gli-gnocchi": gliGnocchi as unknown,
  /** A clean, passing take — the evidence-minting path. */
  clean: clean as unknown,
  /** SNR 4.2 dB — the re-record gate: charged, but no score may be shown. */
  noisy: noisy as unknown,
  /** A skipped word — ErrorType "Omission", no phonemes, completeness < 100. */
  omission: omission as unknown,
} as const;

export type PronunciationFixtureName = keyof typeof PRONUNCIATION_FIXTURES;

/** Parse one committed fixture through the REAL parser — so the fixtures exercise
 *  `parseAzurePaResponse` rather than bypassing it with a hand-built object. */
export function fixtureResult(name: PronunciationFixtureName): PronunciationResult {
  return parseAzurePaResponse(PRONUNCIATION_FIXTURES[name]);
}

/** Calls made through a fixture scorer, for tests that assert reserve-before-call
 *  ordering (what was reserved at the moment the call was made). */
export interface FixtureCall {
  referenceText: string;
  seconds: number;
  bytes: number;
}

export interface FixturePronunciationScorer extends PronunciationScorer {
  readonly calls: FixtureCall[];
}

/**
 * A scorer that answers from a committed fixture. `available` defaults to true;
 * setting it false models the missing-key wall. `onCall` runs BEFORE the result is
 * returned — the hook the money tests use to observe ledger state mid-call, or to
 * throw a provider failure at exactly the right moment.
 */
export function createFixtureScorer(
  name: PronunciationFixtureName,
  opts: { available?: boolean; id?: string; onCall?: (input: PronunciationScoreInput) => void | Promise<void> } = {},
): FixturePronunciationScorer {
  const calls: FixtureCall[] = [];
  return {
    id: opts.id ?? `fixture:${name}`,
    calls,
    isAvailable: () => opts.available !== false,
    async score(input: PronunciationScoreInput): Promise<PronunciationResult> {
      calls.push({ referenceText: input.referenceText, seconds: input.seconds, bytes: input.audio.byteLength });
      if (opts.onCall) await opts.onCall(input);
      return fixtureResult(name);
    },
  };
}
