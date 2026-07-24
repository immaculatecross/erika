import { describe, expect, it } from "vitest";
import {
  azurePaUrl,
  azureSpeechConfig,
  parseAzurePaResponse,
  pronunciationAssessmentHeader,
  pronunciationAssessmentParams,
  azurePronunciationScorer,
  PA_CONTENT_TYPE,
  PA_LANGUAGE,
} from "@/lib/pronunciation/azure";
import { PronunciationParseError } from "@/lib/pronunciation/scorer";
import { PRONUNCIATION_FIXTURES, fixtureResult } from "@/lib/pronunciation/fixture-scorer";

// E-37 the Azure adapter. Everything here is PURE — the request shape, the parse, the
// key handling — so the live integration is verified without a key and without egress
// (the sandbox has neither). What it pins:
//
//   * the exact endpoint / headers / assessment params OBS-002 verified live, and that
//     `EnableProsodyAssessment` is NEVER set (en-US only; the sole add-on-billed score);
//   * the parse of the documented response shape, including the it-IT surface only —
//     no prosody, no syllables, but per-phoneme scores, error types, ticks and n-best;
//   * that the missing-key state is honest: unavailable, never a fabricated score;
//   * SECRET HYGIENE: the key never appears in a URL, in the params, or in an error.

describe("the Azure PA request shape (OBS-002, live-verified 2026-07-24)", () => {
  it("sends exactly the documented assessment params — and never EnableProsodyAssessment", () => {
    const params = pronunciationAssessmentParams("Gli gnocchi sono buonissimi");
    expect(params).toEqual({
      ReferenceText: "Gli gnocchi sono buonissimi",
      GradingSystem: "HundredMark",
      Granularity: "Phoneme",
      Dimension: "Comprehensive",
      EnableMiscue: true,
      NBestPhonemeCount: 5,
    });
    // it-IT returns no prosody, and prosody is the ONLY add-on-billed score. Asking for
    // it would buy a bigger invoice and no data.
    expect(Object.keys(params)).not.toContain("EnableProsodyAssessment");
  });

  it("base64-encodes the params into the Pronunciation-Assessment header", () => {
    const header = pronunciationAssessmentHeader("Ho preso un caffè al bar");
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded.ReferenceText).toBe("Ho preso un caffè al bar");
    expect(decoded.Granularity).toBe("Phoneme");
    expect(decoded.EnableProsodyAssessment).toBeUndefined();
  });

  it("targets the it-IT short-audio recognition path, from an endpoint or a region", () => {
    const fromEndpoint = azurePaUrl({
      key: "k",
      region: null,
      endpoint: "https://myres.cognitiveservices.azure.com/",
    });
    expect(fromEndpoint).toBe(
      "https://myres.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1" +
        `?language=${PA_LANGUAGE}&format=detailed`,
    );

    const fromRegion = azurePaUrl({ key: "k", region: "westeurope", endpoint: null });
    expect(fromRegion).toBe(
      "https://westeurope.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1" +
        `?language=${PA_LANGUAGE}&format=detailed`,
    );

    expect(PA_CONTENT_TYPE).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
  });
});

describe("secret hygiene — AZURE_SPEECH_KEY never leaves the server module", () => {
  const cfg = { key: "super-secret-key-value", region: "westeurope", endpoint: null };

  it("never appears in the request URL (auth is a header)", () => {
    expect(azurePaUrl(cfg)).not.toContain(cfg.key);
  });

  it("never appears in the assessment params sent to the service", () => {
    expect(JSON.stringify(pronunciationAssessmentParams("una frase"))).not.toContain(cfg.key);
  });

  it("is absent → the scorer reports unavailable rather than inventing a score", async () => {
    expect(azureSpeechConfig({})).toBeNull();
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: "" })).toBeNull();
    // A key with no host to send it to is unusable, not a runtime surprise mid-drill.
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: "k" })).toBeNull();
    expect(azureSpeechConfig({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "westeurope" })).toEqual({
      key: "k",
      region: "westeurope",
      endpoint: null,
    });

    // This sandbox has no key, which is exactly the shipped default state.
    delete process.env.AZURE_SPEECH_KEY;
    expect(azurePronunciationScorer.isAvailable()).toBe(false);
    await expect(
      azurePronunciationScorer.score({ referenceText: "ciao", audio: Buffer.alloc(4), seconds: 1 }),
    ).rejects.toThrow(/AZURE_SPEECH_KEY is not set/);
  });
});

describe("parsing a detailed it-IT response", () => {
  it("reads the headline scores, the per-word error types, the phonemes and the ticks", () => {
    const r = fixtureResult("gli-gnocchi");
    expect(r.pronScore).toBeCloseTo(77.2, 5);
    expect(r.accuracyScore).toBe(71);
    expect(r.fluencyScore).toBe(88);
    expect(r.completenessScore).toBe(100);
    expect(r.snrDb).toBeCloseTo(31.4, 5);

    expect(r.words.map((w) => w.word)).toEqual(["gli", "gnocchi", "sono", "buonissimi"]);
    const gli = r.words[0];
    expect(gli.errorType).toBe("Mispronunciation");
    expect(gli.accuracyScore).toBe(38);
    expect(gli.offsetTicks).toBe(300000);
    expect(gli.durationTicks).toBe(2600000);

    // The n-best alternates are what make Italian feedback specific: /l/ beat /ʎ/.
    const palatal = gli.phonemes[0];
    expect(palatal.phoneme).toBe("ʎ");
    expect(palatal.accuracyScore).toBe(24);
    expect(palatal.nBest[0]).toEqual({ phoneme: "l", score: 81 });
  });

  it("carries NO prosody and NO syllable field at all — it-IT has neither", () => {
    const r = fixtureResult("clean");
    expect(Object.keys(r).sort()).toEqual(
      ["accuracyScore", "completenessScore", "fluencyScore", "pronScore", "snrDb", "words"].sort(),
    );
    expect(JSON.stringify(r)).not.toMatch(/prosody/i);
    expect(JSON.stringify(r)).not.toMatch(/syllable/i);
  });

  it("reads an omitted word: ErrorType Omission, no phonemes, completeness below 100", () => {
    const r = fixtureResult("omission");
    const omitted = r.words.find((w) => w.errorType === "Omission")!;
    expect(omitted.word).toBe("ne");
    expect(omitted.phonemes).toEqual([]);
    expect(omitted.durationTicks).toBe(0);
    expect(r.completenessScore).toBe(80);
  });

  it("carries SNR from the response's TOP level, where the service puts it", () => {
    expect(fixtureResult("noisy").snrDb).toBeCloseTo(4.2, 5);
  });

  it("refuses anything it cannot honestly read (the caller then BILLS it: Azure answered)", () => {
    expect(() => parseAzurePaResponse(null)).toThrow(PronunciationParseError);
    expect(() => parseAzurePaResponse({ RecognitionStatus: "NoMatch", NBest: [] })).toThrow(
      /RecognitionStatus was NoMatch/,
    );
    expect(() => parseAzurePaResponse({ RecognitionStatus: "Success" })).toThrow(/no NBest/);
    expect(() =>
      parseAzurePaResponse({ RecognitionStatus: "Success", NBest: [{ PronunciationAssessment: {} }] }),
    ).toThrow(/no per-word assessment/);
  });

  it("tolerates the flattened score shape, so a fixture written either way parses", () => {
    const r = parseAzurePaResponse({
      RecognitionStatus: "Success",
      NBest: [
        {
          PronScore: 90,
          AccuracyScore: 88,
          FluencyScore: 92,
          CompletenessScore: 100,
          Words: [{ Word: "ciao", AccuracyScore: 88, ErrorType: "None", Offset: 0, Duration: 5000000, Phonemes: [] }],
        },
      ],
    });
    expect(r.pronScore).toBe(90);
    expect(r.words[0].word).toBe("ciao");
    expect(r.snrDb).toBeNull(); // absent, and never invented
  });
});

describe("the committed fixtures are labelled synthetic", () => {
  it("every fixture says, in its own data, that it was hand-authored and must be replaced", () => {
    for (const [name, raw] of Object.entries(PRONUNCIATION_FIXTURES)) {
      const note = (raw as { _synthetic?: string })._synthetic;
      expect(note, `${name} must carry a _synthetic label`).toBeTruthy();
      expect(note).toMatch(/SYNTHETIC/);
      expect(note).toMatch(/NOT a captured Azure response/i);
    }
  });
});
