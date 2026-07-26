import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  ARCHITECTURE_OPTIONS,
  DEFAULT_TUTOR_ARCHITECTURE,
  DEFAULT_TUTOR_PRESET,
  PRESET_OPTIONS,
  TRANSCRIPT_LIMITATION,
  type TutorPromptPreset,
} from "@/lib/tutor/experiment";
import {
  PROMPT_DISTINGUISHING_CLAUSES,
  TUTOR_OUTPUT_CONTRACT,
  buildTutorPrompt,
  tutorPromptHash,
} from "@/lib/tutor/prompt-presets";
import {
  buildSelectedTutorPrompt,
  buildTutorPromptContext,
  buildTutorSessionConfig,
} from "@/lib/tutor/session-config";
import {
  TURN_RECOVERY_MESSAGE,
  TutorTurnParseError,
  parseTutorTurnResult,
} from "@/lib/tutor/turn-result";
import { buildTerraRequest, boundedTutorContext } from "@/lib/tutor/terra";
import { TERRA_MODEL } from "@/lib/analysis/rates";
import { decodeSpeechSse, speechStreamDone } from "@/lib/voice/openai-speech";

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-lab-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("experiment choices", () => {
  it("pins two paths, five exact hypotheses, and Native + Current defaults", () => {
    expect(DEFAULT_TUTOR_ARCHITECTURE).toBe("native");
    expect(DEFAULT_TUTOR_PRESET).toBe("current");
    expect(ARCHITECTURE_OPTIONS).toEqual([
      {
        id: "native",
        label: "Native listener — Realtime 2.1",
        description: "Listens directly to your audio, including pronunciation and hesitation.",
      },
      {
        id: "transcript",
        label: "Transcript listener — OpenAI STT + GPT-5.6 Terra",
        description: "Transcribes each turn before coaching, so grammar and word choice can be compared separately.",
      },
    ]);
    expect(PRESET_OPTIONS.map((option) => option.label)).toEqual([
      "Record-equivalent detector",
      "Minimal detector",
      "Balanced coach",
      "Precision first",
      "Current tutor",
    ]);
    expect(TRANSCRIPT_LIMITATION).toBe(
      "This path can compare grammar and word choice, but a transcript cannot preserve pronunciation or hesitation.",
    );
  });
});

describe("five prompts share one envelope but isolate their hypotheses", () => {
  const context = {
    register: "colto" as const,
    targetLanguage: "Italian",
    nativeLanguage: "English",
    profileLines: ["CURRENT PROFILE"],
    slipTargets: ["CURRENT SLIP"],
    todayTargets: ["CURRENT TARGET"],
  };

  it.each(Object.entries(PROMPT_DISTINGUISHING_CLAUSES) as [TutorPromptPreset, string][])(
    "%s pins its distinguishing clause and shared output contract",
    (preset, clause) => {
      const prompt = buildTutorPrompt({ preset, architecture: "native", persona: context });
      expect(prompt).toContain(clause);
      expect(prompt).toContain(TUTOR_OUTPUT_CONTRACT);
      expect(prompt).toMatch(/an empty errors array is valid and expected/i);
      expect(prompt).toMatch(/one-correction|at most one (?:error|correction)/i);
    },
  );

  it("Minimal deliberately removes learner-specific and recurrence priming", () => {
    const prompt = buildTutorPrompt({ preset: "minimal", architecture: "native", persona: context });
    expect(prompt).not.toContain("CURRENT PROFILE");
    expect(prompt).not.toContain("CURRENT SLIP");
    expect(prompt).not.toContain("CURRENT TARGET");
    expect(prompt).not.toContain("What you know about this learner");
    expect(prompt).not.toContain("Recurring mistakes to steer");
    expect(prompt).not.toContain("Today's validated targets");
    expect(prompt).not.toContain("most important job");
  });

  it("only the transcript path forbids pronunciation findings", () => {
    const transcript = buildTutorPrompt({ preset: "balanced", architecture: "transcript", persona: context });
    const native = buildTutorPrompt({ preset: "balanced", architecture: "native", persona: context });
    expect(transcript).toContain("category `pronunciation` is forbidden");
    expect(native).not.toContain("Never return a pronunciation error");
  });
});

describe("the selected prompt is exact on both provider paths", () => {
  it.each(["record-equivalent", "minimal", "balanced", "precision", "current"] as const)(
    "wires %s without provider-specific drift",
    (preset) => {
      const db = freshDb();
      const context = buildTutorPromptContext(db);
      const expected = buildSelectedTutorPrompt(db, "native", preset);
      const native = buildTutorSessionConfig(db, undefined, preset);
      expect(native.config.instructions).toBe(expected.prompt);
      expect(native.promptHash).toBe(tutorPromptHash(expected.prompt));

      const transcript = buildSelectedTutorPrompt(db, "transcript", preset);
      const terra = buildTerraRequest({
        prompt: transcript.prompt,
        transcript: "Ieri sono andato al cinema.",
        context: [],
      });
      expect(terra.instructions).toBe(transcript.prompt);
      expect(tutorPromptHash(transcript.prompt)).toMatch(/^[a-f0-9]{64}$/);
      expect(context.persona.targetLanguage).toBe("Italian");
      db.close();
    },
  );

  it("uses the proved Terra model, low reasoning field, and strict schema", () => {
    const request = buildTerraRequest({
      prompt: "PROMPT",
      transcript: "Ciao.",
      context: [],
    });
    expect(request.model).toBe(TERRA_MODEL);
    expect(request.reasoning).toEqual({ effort: "low" });
    const text = request.text as {
      format: { type: string; strict: boolean; schema: { additionalProperties: boolean } };
    };
    expect(text.format.type).toBe("json_schema");
    expect(text.format.strict).toBe(true);
    expect(text.format.schema.additionalProperties).toBe(false);
  });

  it("bounds transcript history by complete newest turns", () => {
    const turn = { learner: "l".repeat(6_000), tutor: "t".repeat(6_000) };
    const bounded = boundedTutorContext([turn, turn, turn]);
    expect(bounded).toHaveLength(1);
    expect(bounded[0].learner).toHaveLength(4_000);
    expect(bounded[0].tutor).toHaveLength(2_000);
  });
});

describe("one strict parsed turn boundary", () => {
  const valid = JSON.stringify({
    errors: [
      {
        quote: "ho andato",
        correction: "sono andato",
        category: "grammar",
        explanation: "Movimento usa essere.",
        confidence: "high",
      },
    ],
    reply: "Sei andato al cinema?",
    evidence: [{ itemId: "rule:essere", polarity: "incorrect", mode: "spontaneous" }],
  });

  it("accepts an empty error list and keeps pronunciation on native audio", () => {
    expect(
      parseTutorTurnResult('{"errors":[],"reply":"Dimmi di più.","evidence":[]}', {
        allowPronunciation: true,
      }).result.errors,
    ).toEqual([]);
    const pronunciation = valid.replace('"grammar"', '"pronunciation"');
    expect(parseTutorTurnResult(pronunciation, { allowPronunciation: true }).result.errors).toHaveLength(1);
  });

  it("visibly drops transcript-only pronunciation claims", () => {
    const pronunciation = valid.replace('"grammar"', '"pronunciation"');
    const parsed = parseTutorTurnResult(pronunciation, { allowPronunciation: false });
    expect(parsed.result.errors).toEqual([]);
    expect(parsed.droppedErrors).toEqual([
      expect.objectContaining({ quote: "ho andato", category: "pronunciation" }),
    ]);
  });

  it.each([
    ["fenced", `\`\`\`json\n${valid}\n\`\`\``],
    ["truncated", valid.slice(0, -4)],
    ["off-schema", valid.replace('"reply":', '"extra":true,"reply":')],
    ["wrong confidence", valid.replace('"high"', '"low"')],
  ])("rejects %s output before evidence or speech", (_label, raw) => {
    expect(() => parseTutorTurnResult(raw, { allowPronunciation: true })).toThrow(
      TutorTurnParseError,
    );
    expect(TURN_RECOVERY_MESSAGE).toContain("could not read that turn safely");
  });
});

describe("streaming tutor speech", () => {
  it("stops at the provider terminal event even when the HTTP stream stays open", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"speech.audio.delta","audio":"AQID"}\n\ndata: {"type":"speech.audio.done"}\n\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of decodeSpeechSse(new Response(body))) chunks.push(chunk);
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(cancelled).toBe(true);
    expect(speechStreamDone("data: [DONE]")).toBe(true);
  });
});
