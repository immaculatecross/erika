import { describe, expect, it, vi } from "vitest";
import {
  connectTutor,
  dispatchRealtimeEvent,
  extractTextDelta,
  isResponseComplete,
  isSpeechStarted,
  openingResponse,
  type DataChannelLike,
  type MediaStreamLike,
  type PeerConnectionLike,
} from "@/lib/tutor/realtime-client";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";
import { TUTOR_OPENING } from "@/lib/tutor/persona";

// The transport-(A) half of E-43: audio in, TEXT out, spoken through TTS (D-28).
// `tests/tutor-realtime-client.test.ts` still covers the SDP handshake and the
// log_evidence dispatch unchanged — this file covers only what the text-out decision
// added.

describe("the tutor's reply arrives as text on the same data channel", () => {
  it("extracts a delta under EITHER the GA or the beta event name", () => {
    // spike-6 proved the SESSION contract (§0/§4) but did not enumerate the text event
    // names, and a hard-coded name that turned out to be the other one would leave the
    // tutor permanently silent with every test green — the same class of silent
    // failure as the mint allowlist. Both suffixes are accepted.
    for (const type of ["response.output_text.delta", "response.text.delta"]) {
      expect(extractTextDelta({ type, delta: "Ciao" })).toBe("Ciao");
    }
  });

  it("ignores events that carry no text", () => {
    expect(extractTextDelta({ type: "response.output_audio.delta", delta: "AAA" })).toBeNull();
    expect(extractTextDelta({ type: "response.output_text.delta" })).toBeNull();
    expect(extractTextDelta({ type: "input_audio_buffer.speech_started" })).toBeNull();
  });

  it("recognises the end of a turn and the start of the learner's speech", () => {
    expect(isResponseComplete({ type: "response.done" })).toBe(true);
    expect(isResponseComplete({ type: "response.output_text.delta" })).toBe(false);
    expect(isSpeechStarted({ type: "input_audio_buffer.speech_started" })).toBe(true);
    expect(isSpeechStarted({ type: "input_audio_buffer.speech_stopped" })).toBe(false);
  });

  it("routes deltas, turn-end and barge-in to their handlers, and still logs evidence", () => {
    const onTextDelta = vi.fn();
    const onTurnComplete = vi.fn();
    const onSpeechStarted = vi.fn();
    const onLogEvidence = vi.fn();
    const handlers = { onLogEvidence, onTextDelta, onTurnComplete, onSpeechStarted };
    dispatchRealtimeEvent({ type: "response.output_text.delta", delta: "Ciao!" }, handlers);
    dispatchRealtimeEvent({ type: "response.done" }, handlers);
    dispatchRealtimeEvent({ type: "input_audio_buffer.speech_started" }, handlers);
    dispatchRealtimeEvent(
      {
        type: "response.function_call_arguments.done",
        name: "log_evidence",
        arguments: JSON.stringify({ itemId: "rule:x", polarity: "incorrect", mode: "spontaneous" }),
      },
      handlers,
    );
    expect(onTextDelta).toHaveBeenCalledWith("Ciao!");
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(onLogEvidence).toHaveBeenCalledTimes(1);
  });
});

describe("Erika speaks first", () => {
  function fakePeer(sent: string[]): { pc: PeerConnectionLike; channel: () => DataChannelLike } {
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
      close: vi.fn(),
    };
    return { pc, channel: () => channel as DataChannelLike };
  }

  it("sends a response.create with the opening instruction once the channel opens", async () => {
    // Without this a learner who has never seen the app meets silence and has no way
    // to know whose turn it is. The persona still governs every turn after this one.
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connectTutor({
      clientSecret: "ek_x",
      model: "gpt-realtime-2.1",
      greeting: TUTOR_OPENING,
      handlers: { onLogEvidence: vi.fn() },
      getMicStream: async () => ({ getTracks: () => [{ kind: "audio" }] }) as MediaStreamLike,
      createPeerConnection: () => pc,
      exchangeSdp: async () => "A",
    });
    expect(sent).toHaveLength(0); // nothing before the channel is open
    channel().onopen?.();
    expect(JSON.parse(sent[0])).toEqual({ type: "response.create", response: { instructions: TUTOR_OPENING } });
  });

  it("wires no opening at all when none is configured", async () => {
    const sent: string[] = [];
    const { pc, channel } = fakePeer(sent);
    await connectTutor({
      clientSecret: "ek_x",
      model: "gpt-realtime-2.1",
      handlers: { onLogEvidence: vi.fn() },
      getMicStream: async () => ({ getTracks: () => [{ kind: "audio" }] }) as MediaStreamLike,
      createPeerConnection: () => pc,
      exchangeSdp: async () => "A",
    });
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

describe("output_modalities survives all the way to the wire", () => {
  it("is carried by the mint body, not dropped by the allowlist", async () => {
    // The mint builds its body from an explicit allowlist, and `["audio"]` is the
    // API's default when the field is absent — so a drop here does NOT 400, it
    // silently mints the very session D-28 exists to replace (spike-6 §9 condition 3).
    const { buildTutorSessionConfig } = await import("@/lib/tutor/session-config");
    const { openDatabase } = await import("@/lib/db");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-wire-"));
    const db = openDatabase(path.join(dir, "erika.db"));
    const { config } = buildTutorSessionConfig(db);
    const wire = buildMintSessionWireBody(config) as unknown as Record<string, unknown>;
    expect(wire.output_modalities).toEqual(["text"]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
