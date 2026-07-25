import { describe, expect, it, vi } from "vitest";
import {
  connectTutor,
  continueResponse,
  dispatchRealtimeEvent,
  functionCallOutput,
  isAudioDelta,
  isResponseComplete,
  isSpeechStarted,
  openingResponse,
  MAX_CONTINUATIONS_PER_TURN,
  type DataChannelLike,
  type MediaStreamLike,
  type PeerConnectionLike,
} from "@/lib/tutor/realtime-client";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";
import { TUTOR_OPENING } from "@/lib/tutor/persona";
import { REALTIME_VOICES } from "@/lib/tutor/voices";

// The transport half of E-43 after Amendment 5: audio in, AUDIO out, one connection.
// `tests/tutor-realtime-client.test.ts` covers the SDP handshake and the log_evidence
// extraction; this file covers what the audio-out decision owns — the voice track, the
// turn-state signals, and answering the tool call.

function fakePeer(sent: string[]): {
  pc: PeerConnectionLike;
  channel: () => DataChannelLike;
  fireTrack: (s: MediaStreamLike) => void;
} {
  let channel: DataChannelLike | null = null;
  const pc: PeerConnectionLike = {
    createDataChannel() {
      channel = { onmessage: null, onopen: null, send: (d: string) => sent.push(d) };
      return channel;
    },
    addTrack: vi.fn(),
    createOffer: async () => ({ type: "offer", sdp: "O" }),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    ontrack: null,
    close: vi.fn(),
  };
  return {
    pc,
    channel: () => channel as DataChannelLike,
    fireTrack: (s) => pc.ontrack?.({ streams: [s] }),
  };
}

async function connect(pc: PeerConnectionLike, extra: Record<string, unknown> = {}) {
  return connectTutor({
    clientSecret: "ek_x",
    model: "gpt-realtime-2.1",
    handlers: { onLogEvidence: vi.fn() },
    getMicStream: async () => ({ getTracks: () => [{ kind: "audio" }] }) as MediaStreamLike,
    createPeerConnection: () => pc,
    exchangeSdp: async () => "A",
    ...extra,
  });
}

/** Feed one event in through the real channel wiring, as the API would. */
function deliver(channel: DataChannelLike, event: Record<string, unknown>) {
  channel.onmessage?.({ data: JSON.stringify(event) });
}

describe("the tutor's voice arrives on the media track, not the data channel", () => {
  it("hands the remote stream to the caller the moment the track fires", async () => {
    // Under `output_modalities: ["text"]` there was deliberately NO ontrack handler and
    // audio only went up. Restoring it is the whole revert; without it the tutor is
    // connected, billing, and completely silent.
    const onRemoteAudio = vi.fn();
    const { pc, fireTrack } = fakePeer([]);
    await connect(pc, { onRemoteAudio });
    const stream = { getTracks: () => [{ kind: "audio" }] } as MediaStreamLike;
    fireTrack(stream);
    expect(onRemoteAudio).toHaveBeenCalledWith(stream);
  });

  it("recognises an audio delta under EITHER the GA or the beta event name", () => {
    // spike-7 §2 measured only the GA name (`response.output_audio.delta`) arriving on
    // this account; the beta lineage used `response.audio.delta`. Matching the suffix
    // costs nothing and cannot strand the turn line on the wrong state.
    expect(isAudioDelta({ type: "response.output_audio.delta", delta: "AAA" })).toBe(true);
    expect(isAudioDelta({ type: "response.audio.delta", delta: "AAA" })).toBe(true);
    expect(isAudioDelta({ type: "input_audio_buffer.speech_started" })).toBe(false);
    expect(isAudioDelta({ type: "response.done" })).toBe(false);
  });

  it("recognises the end of a turn and the start of the learner's speech", () => {
    expect(isResponseComplete({ type: "response.done" })).toBe(true);
    expect(isResponseComplete({ type: "response.output_audio.delta" })).toBe(false);
    expect(isSpeechStarted({ type: "input_audio_buffer.speech_started" })).toBe(true);
    expect(isSpeechStarted({ type: "input_audio_buffer.speech_stopped" })).toBe(false);
  });

  it("routes speaking, turn-end and the learner's speech to their handlers, and still logs evidence", () => {
    const onSpeakingStarted = vi.fn();
    const onTurnComplete = vi.fn();
    const onSpeechStarted = vi.fn();
    const onLogEvidence = vi.fn();
    const handlers = { onLogEvidence, onSpeakingStarted, onTurnComplete, onSpeechStarted };
    dispatchRealtimeEvent({ type: "response.output_audio.delta", delta: "AAA" }, handlers);
    dispatchRealtimeEvent({ type: "response.done" }, handlers);
    dispatchRealtimeEvent({ type: "input_audio_buffer.speech_started" }, handlers);
    dispatchRealtimeEvent(
      {
        type: "response.function_call_arguments.done",
        name: "log_evidence",
        call_id: "call_1",
        arguments: JSON.stringify({ itemId: "rule:x", polarity: "incorrect", mode: "spontaneous" }),
      },
      handlers,
    );
    expect(onSpeakingStarted).toHaveBeenCalledTimes(1);
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(onLogEvidence).toHaveBeenCalledWith(
      { itemId: "rule:x", polarity: "incorrect", mode: "spontaneous" },
      "call_1",
    );
  });
});

describe("the tool call is ANSWERED, so the correction actually gets spoken", () => {
  // 🚩 THE DEFECT THIS GUARDS, MEASURED LIVE ON THE SHIPPING CONFIGURATION: the
  // `call_id` was extracted and thrown away, so the model never received
  // `function_call_output`. A Realtime function call is a REQUEST — the model speaks a
  // short holding line while it is in flight and waits for the result before finishing
  // its turn. 5 of 9 labelled fixtures replied with ONLY a holding line ("Un momento,
  // ti rispondo con una correzione mirata e poi proseguiamo") and never spoke the
  // correction. Answering the same fixture yields "Hai detto 'ieri ho andato al
  // cinema': l'errore è nell'ausiliare… quindi 'ieri sono andato al cinema'."
  //
  // Every assertion below is on what reaches the WIRE, because that is the only place
  // the bug was visible: the old code called the app's handler perfectly.

  const evidenceEvent = (callId: string | null = "call_1") => ({
    type: "response.function_call_arguments.done",
    name: "log_evidence",
    ...(callId === null ? {} : { call_id: callId }),
    arguments: JSON.stringify({ itemId: "rule:noun-gender", polarity: "incorrect", mode: "spontaneous" }),
  });

  it("sends function_call_output carrying the model's own call_id", async () => {
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc);
    deliver(channel(), evidenceEvent("call_abc"));
    const wire = sent.map((s) => JSON.parse(s));
    const output = wire.find((w) => w.type === "conversation.item.create");
    expect(output).toBeDefined();
    expect(output.item.type).toBe("function_call_output");
    // The id must be the one the MODEL sent. A fabricated or dropped id is not an
    // answer, and the model would keep waiting exactly as it did before.
    expect(output.item.call_id).toBe("call_abc");
  });

  it("asks for the held turn only AFTER the holding response finishes", async () => {
    // `response.create` while a response is still streaming is an API error
    // (`conversation_already_has_active_response`), so the continuation waits for
    // `response.done`. Ordering is the contract, not an implementation detail.
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc);
    deliver(channel(), evidenceEvent());
    expect(sent.map((s) => JSON.parse(s).type)).not.toContain("response.create");
    deliver(channel(), { type: "response.done" });
    expect(sent.map((s) => JSON.parse(s).type)).toEqual(["conversation.item.create", "response.create"]);
  });

  it("does not ask for a continuation when no tool was called", async () => {
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc);
    deliver(channel(), { type: "response.done" });
    expect(sent).toHaveLength(0);
  });

  it("bounds continuations per learner turn, so one sentence cannot bill forever", async () => {
    // The opposite failure, asked before writing the fix: a model that logs evidence
    // inside its continuation would drive an unbounded chain of billed responses off a
    // single learner sentence.
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc);
    for (let i = 0; i < 5; i++) {
      deliver(channel(), evidenceEvent(`call_${i}`));
      deliver(channel(), { type: "response.done" });
    }
    const creates = sent.map((s) => JSON.parse(s)).filter((w) => w.type === "response.create");
    expect(creates).toHaveLength(MAX_CONTINUATIONS_PER_TURN);
  });

  it("gives each new learner turn its own budget, and abandons what an interruption owed", async () => {
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc);
    deliver(channel(), evidenceEvent("call_1"));
    deliver(channel(), { type: "response.done" }); // continuation 1 of turn 1
    deliver(channel(), { type: "input_audio_buffer.speech_started" }); // a new learner turn
    deliver(channel(), evidenceEvent("call_2"));
    deliver(channel(), { type: "response.done" }); // continuation 1 of turn 2
    const creates = sent.map((s) => JSON.parse(s)).filter((w) => w.type === "response.create");
    expect(creates).toHaveLength(2);

    // …and a turn the learner talks over owes nothing afterwards.
    const before = sent.length;
    deliver(channel(), evidenceEvent("call_3"));
    deliver(channel(), { type: "input_audio_buffer.speech_started" });
    deliver(channel(), { type: "response.done" });
    const after = sent.slice(before).map((s) => JSON.parse(s));
    expect(after.filter((w) => w.type === "response.create")).toHaveLength(0);
  });

  it("still forwards the evidence to the app, whatever it does with it", async () => {
    const onLogEvidence = vi.fn();
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc, { handlers: { onLogEvidence } });
    deliver(channel(), evidenceEvent("call_1"));
    expect(onLogEvidence).toHaveBeenCalledWith(
      { itemId: "rule:noun-gender", polarity: "incorrect", mode: "spontaneous" },
      "call_1",
    );
  });

  it("builds the answer and the continuation as plain wire shapes", () => {
    expect(functionCallOutput("c1", { ok: true })).toEqual({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "c1", output: JSON.stringify({ ok: true }) },
    });
    expect(continueResponse()).toEqual({ type: "response.create" });
  });
});

describe("Erika speaks first", () => {
  it("sends a response.create with the opening instruction once the channel opens", async () => {
    // Without this a learner who has never seen the app meets silence and has no way
    // to know whose turn it is. The persona still governs every turn after this one.
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc, { greeting: TUTOR_OPENING });
    expect(sent).toHaveLength(0); // nothing before the channel is open
    channel().onopen?.();
    expect(JSON.parse(sent[0])).toEqual({ type: "response.create", response: { instructions: TUTOR_OPENING } });
  });

  it("wires no opening at all when none is configured", async () => {
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connect(pc);
    expect(channel().onopen ?? null).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("asks for one short greeting and one open question, and explains nothing", () => {
    expect(openingResponse("x")).toEqual({ type: "response.create", response: { instructions: "x" } });
    expect(TUTOR_OPENING).toMatch(/Italian/);
    expect(TUTOR_OPENING).toMatch(/question/i);
    expect(TUTOR_OPENING).toMatch(/Do not explain/i);
  });
});

describe("the session's output modality and voice survive to the wire", () => {
  async function wireBody() {
    const { buildTutorSessionConfig } = await import("@/lib/tutor/session-config");
    const { openDatabase } = await import("@/lib/db");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-wire-"));
    const db = openDatabase(path.join(dir, "erika.db"));
    const { config } = buildTutorSessionConfig(db);
    const wire = buildMintSessionWireBody(config) as unknown as Record<string, unknown>;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return wire;
  }

  it("carries audio output and a real voice, neither dropped by the allowlist", async () => {
    // The mint builds its body from an explicit allowlist rather than by spreading the
    // config, so a field missing from that list is silently absent rather than a 400.
    const wire = await wireBody();
    expect(wire.output_modalities).toEqual(["audio"]);
    const audio = wire.audio as { output?: { voice?: string }; input?: unknown };
    expect(audio.input).toBeDefined();
    // The voice must be one the Realtime API accepts — an unknown value is HTTP 400 on
    // the mint, which means no conversation at all (spike-7 §1.1).
    expect(REALTIME_VOICES).toContain(audio.output?.voice);
  });

  it("never sends the internal session ceiling, which is not an OpenAI field", async () => {
    // OBS-001: a fabricated `maxSessionSeconds` 400'd the mint and broke the tutor in
    // real use while CI stayed green.
    const wire = await wireBody();
    expect(wire.maxSessionSeconds).toBeUndefined();
  });
});
