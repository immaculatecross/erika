import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  connectTutor,
  manualTurnEvents,
  type DataChannelLike,
  type MediaStreamLike,
  type PeerConnectionLike,
} from "@/lib/tutor/realtime-client";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";
import { openDatabase } from "@/lib/db";

function fakeTransport() {
  const sent: Record<string, unknown>[] = [];
  const track = { kind: "audio", enabled: true };
  let channel: DataChannelLike | null = null;
  const pc: PeerConnectionLike = {
    createDataChannel() {
      channel = {
        readyState: "open",
        onmessage: null,
        onopen: null,
        send: (value) => sent.push(JSON.parse(value) as Record<string, unknown>),
      };
      return channel;
    },
    addTrack: vi.fn(),
    createOffer: async () => ({ type: "offer", sdp: "offer" }),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    ontrack: null,
    close: vi.fn(),
  };
  return { sent, track, pc, channel: () => channel as DataChannelLike };
}

async function connect() {
  const transport = fakeTransport();
  const onTurnText = vi.fn();
  const connection = await connectTutor({
    clientSecret: "ek_ephemeral_test",
    model: "gpt-realtime-2.1",
    handlers: { onLogEvidence: vi.fn(), onTurnText },
    getMicStream: async () =>
      ({ getTracks: () => [transport.track] }) as unknown as MediaStreamLike,
    createPeerConnection: () => transport.pc,
    exchangeSdp: async () => "answer",
  });
  return { ...transport, connection, onTurnText };
}

describe("manual Realtime turns", () => {
  it("keeps the model mic closed until Speak and emits no response while waiting", async () => {
    const { connection, track, sent } = await connect();
    expect(track.enabled).toBe(false);
    expect(connection.isRecording()).toBe(false);
    expect(sent).toEqual([]);

    expect(connection.beginTurn()).toBe(true);
    expect(track.enabled).toBe(true);
    expect(connection.isRecording()).toBe(true);
    expect(sent).toEqual([]);
  });

  it("Done sends exactly one commit and one response.create; double taps do nothing", async () => {
    const { connection, track, sent } = await connect();
    expect(connection.beginTurn()).toBe(true);
    expect(connection.beginTurn()).toBe(false);
    expect(connection.commitTurn()).toBe(true);
    expect(connection.commitTurn()).toBe(false);
    expect(track.enabled).toBe(false);
    expect(sent).toEqual(manualTurnEvents());
    expect(sent.filter((event) => event.type === "input_audio_buffer.commit")).toHaveLength(1);
    expect(sent.filter((event) => event.type === "response.create")).toHaveLength(1);
  });

  it("buffers text deltas until response.done, then reports usage once", async () => {
    const { channel, onTurnText } = await connect();
    channel().onmessage?.({
      data: JSON.stringify({ type: "response.output_text.delta", delta: '{"errors":[],' }),
    });
    channel().onmessage?.({
      data: JSON.stringify({ type: "response.output_text.delta", delta: '"reply":"Ciao","evidence":[]}' }),
    });
    expect(onTurnText).not.toHaveBeenCalled();
    channel().onmessage?.({
      data: JSON.stringify({
        type: "response.done",
        response: {
          usage: {
            input_tokens: 30,
            output_tokens: 8,
            input_token_details: {
              audio_tokens: 20,
              text_tokens: 10,
              cached_tokens: 4,
              cached_tokens_details: { audio_tokens: 3, text_tokens: 1 },
            },
            output_token_details: { text_tokens: 8, reasoning_tokens: 2 },
          },
        },
      }),
    });
    expect(onTurnText).toHaveBeenCalledTimes(1);
    expect(onTurnText).toHaveBeenCalledWith(
      '{"errors":[],"reply":"Ciao","evidence":[]}',
      {
        inputTokens: 30,
        cachedInputTokens: 4,
        audioInputTokens: 20,
        cachedAudioInputTokens: 3,
        outputTokens: 8,
        reasoningTokens: 2,
      },
    );
  });

  it("permits one bounded repair only after the failed response has closed", async () => {
    const { connection, channel, sent } = await connect();
    connection.beginTurn();
    connection.commitTurn();
    expect(connection.requestRepair("bad")).toBe(false);
    channel().onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
    expect(connection.requestRepair("bad")).toBe(true);
    expect(connection.requestRepair("bad again")).toBe(false);
    expect(sent.filter((event) => event.type === "response.create")).toHaveLength(2);
  });
});

describe("the mint wire keeps manual text-out intact", () => {
  it("sends text output, null turn detection, and no server-only ceiling", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-wire-"));
    const db = openDatabase(path.join(dir, "erika.db"));
    try {
      const { buildTutorSessionConfig } = await import("@/lib/tutor/session-config");
      const wire = buildMintSessionWireBody(buildTutorSessionConfig(db).config);
      expect(wire.output_modalities).toEqual(["text"]);
      expect(wire.audio.input.turn_detection).toBeNull();
      expect("output" in wire.audio).toBe(false);
      expect("maxSessionSeconds" in wire).toBe(false);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
