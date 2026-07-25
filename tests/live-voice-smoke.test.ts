import { describe, expect, it } from "vitest";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";
import { TUTOR_TURN_DETECTION } from "@/lib/tutor/session-config";
import { DEFAULT_TUTOR_VOICE, JUDGED_VOICE, REALTIME_VOICES } from "@/lib/tutor/voices";
import { REALTIME_FLAGSHIP, REALTIME_MINI } from "@/lib/analysis/rates";

// OBS-001 — THE CHEAPEST POSSIBLE REAL CALL PER INTEGRATION. Owed since v0.5.
//
// Skipped entirely without `OPENAI_API_KEY`, so CI and every contributor without a key
// run exactly as before. With a key, each test makes ONE real request and asserts only
// that the response PARSES — never that a model said anything in particular, which
// would be a flaky assertion about a stochastic system.
//
// WHY THESE EXIST AT ALL, in this repo's own words: "no path in this app has ever run
// against a live API", and the v0.6 tutor bug — a fabricated `maxSessionSeconds` field
// that 400'd OpenAI and broke the tutor in real use while CI stayed green — is the
// proof that a mock cannot catch contract drift.
//
// ⚠️ THE TTS AND STT SMOKES ARE GONE WITH THE CODE THEY COVERED. This branch briefly
// synthesized the tutor's reply through `/v1/audio/speech` and had a smoke for it; the
// operator sent the speaking leg back to Realtime audio-out and those implementations
// were deleted, so keeping their smokes would be testing nothing. What remains is the
// integration the tutor actually has, and it now covers BOTH tiers and the voice enum —
// the two things that would silently break a conversation.
//
// A mint costs nothing: no session is ever opened, so no audio is billed.

const KEY = process.env.OPENAI_API_KEY;
const live = KEY ? describe : describe.skip;

/** Mint through the product's OWN allowlist builder, never a hand-written body — a
 *  hand-written approximation is how the mint-body bug survived review. */
async function mint(session: Record<string, unknown>): Promise<Response> {
  return fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ session }),
  });
}

function wireFor(model: string, voice: string) {
  return buildMintSessionWireBody({
    type: "realtime",
    model: model as typeof REALTIME_FLAGSHIP,
    instructions: "Rispondi in italiano.",
    output_modalities: ["audio"],
    audio: {
      input: { turn_detection: TUTOR_TURN_DETECTION },
      output: { voice: voice as (typeof REALTIME_VOICES)[number] },
    },
    tools: [],
    tool_choice: "auto",
    maxSessionSeconds: 1800,
  }) as unknown as Record<string, unknown>;
}

live("live: the Realtime mint accepts this product's own audio-out session", () => {
  it("mints an ephemeral secret for an audio-in / AUDIO-out session on the default tier", async () => {
    const res = await mint(wireFor(REALTIME_FLAGSHIP, DEFAULT_TUTOR_VOICE));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value?: string; session?: Record<string, unknown> };
    expect(typeof body.value).toBe("string");
    expect(body.value?.startsWith("ek_")).toBe(true);
    // Echoed back rather than silently altered — the gating fact of the revert.
    expect(body.session?.output_modalities).toEqual(["audio"]);
    const audio = body.session?.audio as { output?: { voice?: string } } | undefined;
    expect(audio?.output?.voice).toBe(DEFAULT_TUTOR_VOICE);
  }, 30_000);

  it("accepts the other tier too, so the Settings dial cannot offer a dead option", async () => {
    // The tier dial is learner-facing. A tier the mint rejects would be a Settings
    // choice that breaks every conversation for whoever picked it.
    const res = await mint(wireFor(REALTIME_MINI, DEFAULT_TUTOR_VOICE));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { value?: string }).value?.startsWith("ek_")).toBe(true);
  }, 30_000);

  it("rejects a voice that is not in the enum — the check the dial depends on", async () => {
    // `nova` is a real OpenAI TTS voice and was this branch's default while the
    // speaking leg was TTS. On Realtime it is HTTP 400 (spike-7 §1.2). This asserts the
    // enum is REAL rather than trusting a list copied from a datasheet: if our list
    // contained something OpenAI rejects, a learner could pick a voice that kills the
    // tutor for them and nothing else would catch it.
    const res = await mint(wireFor(REALTIME_FLAGSHIP, "nova"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    // The error names the supported set; every voice we offer must appear in it.
    const message = body.error?.message ?? "";
    for (const voice of REALTIME_VOICES) expect(message).toContain(voice);
  }, 30_000);
});

describe("the voice dial, without a key", () => {
  it("offers ten voices and defaults to one the operator's verdict was NOT formed against", () => {
    // Their "it does not speak super well" was passed on `marin` alone — the only
    // Realtime voice this repo ever carried. Defaulting back to it would re-ship the
    // exact thing that was rejected.
    expect(REALTIME_VOICES).toHaveLength(10);
    expect(REALTIME_VOICES).toContain(JUDGED_VOICE);
    expect(DEFAULT_TUTOR_VOICE).not.toBe(JUDGED_VOICE);
    expect(REALTIME_VOICES).toContain(DEFAULT_TUTOR_VOICE);
  });
});
