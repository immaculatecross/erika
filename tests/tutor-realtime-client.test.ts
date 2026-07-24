import { describe, expect, it, vi } from "vitest";
import {
  parseRealtimeEvent,
  extractLogEvidenceCall,
  dispatchRealtimeEvent,
  connectTutor,
  REALTIME_EVENT_CHANNEL,
  type DataChannelLike,
  type MediaStreamLike,
  type PeerConnectionLike,
} from "@/lib/tutor/realtime-client";

// The WebRTC client seam (E-34, WO criterion 1). The SDP handshake, the data-channel
// wiring, and the log_evidence dispatch are unit-tested against fakes; the browser
// connects with ONLY the ephemeral secret. No real RTCPeerConnection, no network.

describe("realtime event parsing + log_evidence extraction", () => {
  it("extracts a completed log_evidence tool call and parses its JSON args", () => {
    const event = parseRealtimeEvent(
      JSON.stringify({
        type: "response.function_call_arguments.done",
        name: "log_evidence",
        call_id: "call_1",
        arguments: JSON.stringify({ itemId: "lemma:casa#NOUN", polarity: "correct", mode: "spontaneous" }),
      }),
    );
    expect(event).not.toBeNull();
    const call = extractLogEvidenceCall(event!);
    expect(call).not.toBeNull();
    expect(call!.callId).toBe("call_1");
    expect(call!.args).toEqual({ itemId: "lemma:casa#NOUN", polarity: "correct", mode: "spontaneous" });
  });

  it("ignores non-log_evidence and non-JSON events", () => {
    expect(parseRealtimeEvent("not json")).toBeNull();
    const other = parseRealtimeEvent(JSON.stringify({ type: "response.audio.delta" }))!;
    expect(extractLogEvidenceCall(other)).toBeNull();
  });

  it("dispatches a log_evidence call to the handler, once", () => {
    const onLogEvidence = vi.fn();
    const event = {
      type: "response.function_call_arguments.done",
      name: "log_evidence",
      arguments: JSON.stringify({ itemId: "rule:articoli", polarity: "incorrect", mode: "cued" }),
    };
    dispatchRealtimeEvent(event, { onLogEvidence });
    expect(onLogEvidence).toHaveBeenCalledTimes(1);
    expect(onLogEvidence).toHaveBeenCalledWith({ itemId: "rule:articoli", polarity: "incorrect", mode: "cued" });
  });
});

describe("connectTutor handshake (against fakes)", () => {
  it("captures mic, opens the event channel, exchanges SDP with the EPHEMERAL secret, and routes log_evidence", async () => {
    const onLogEvidence = vi.fn();
    let channel: DataChannelLike | null = null;
    const stream: MediaStreamLike = { getTracks: () => [{ kind: "audio" }] };

    const pc: PeerConnectionLike = {
      createDataChannel(label) {
        expect(label).toBe(REALTIME_EVENT_CHANNEL);
        channel = { onmessage: null, send: vi.fn() };
        return channel;
      },
      addTrack: vi.fn(),
      createOffer: async () => ({ type: "offer", sdp: "OFFER_SDP" }),
      setLocalDescription: vi.fn(async () => {}),
      setRemoteDescription: vi.fn(async () => {}),
      ontrack: null,
      close: vi.fn(),
    };

    let sentSecret: string | null = null;
    let sentOffer: string | null = null;
    const conn = await connectTutor({
      clientSecret: "ek_ephemeral_only",
      model: "gpt-realtime-2.1",
      handlers: { onLogEvidence },
      getMicStream: async () => stream,
      createPeerConnection: () => pc,
      exchangeSdp: async (offer, opts) => {
        sentOffer = offer;
        sentSecret = opts.clientSecret;
        return "ANSWER_SDP";
      },
    });

    // The mic track was added and the remote answer applied.
    expect(pc.addTrack).toHaveBeenCalled();
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "ANSWER_SDP" });
    // The SDP exchange used the EPHEMERAL secret — never a real key.
    expect(sentOffer).toBe("OFFER_SDP");
    expect(sentSecret).toBe("ek_ephemeral_only");

    // A log_evidence event arriving on the channel reaches the handler.
    channel!.onmessage!({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        name: "log_evidence",
        arguments: JSON.stringify({ itemId: "lemma:casa#NOUN", polarity: "correct", mode: "cued" }),
      }),
    });
    expect(onLogEvidence).toHaveBeenCalledWith({ itemId: "lemma:casa#NOUN", polarity: "correct", mode: "cued" });

    conn.stop();
    expect(pc.close).toHaveBeenCalled();
  });
});
