// The WebRTC client seam for the tutor (E-34). The browser connects to the Realtime
// API using ONLY the short-lived ephemeral client secret the server minted — never
// the real API key (secret-exposure, never-waivable). Everything WebRTC-shaped is
// behind injectable dependencies, so the SDP offer/answer handshake, the data-channel
// wiring, and the `log_evidence` dispatch are all UNIT-TESTED against fakes; the LIVE
// connection (real RTCPeerConnection + a browser + api.openai.com allowlisted) is the
// operator-gated follow-up (WO). Client-safe: no node imports, no key.
//
// The realtime data channel carries JSON events. When the model calls `log_evidence`,
// a `response.function_call_arguments.done` event arrives with the tool name and a
// JSON-string `arguments`; `dispatchRealtimeEvent` parses it and hands the args to the
// caller, which forwards them to POST /api/tutor/evidence (the server validates the id
// and writes the append-only row — this client never mints an id).

/** The realtime SDP endpoint. Pinned to the account's real endpoint at real-run
 *  (the live call is operator-gated); the ephemeral secret authorizes it, not the key. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/** The event data channel name the Realtime API expects. */
export const REALTIME_EVENT_CHANNEL = "oai-events";

// ── event dispatch (pure, unit-tested) ───────────────────────────────────────

export interface RealtimeEvent {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  [k: string]: unknown;
}

/** Parse a data-channel message payload into an event, or null if it is not JSON. */
export function parseRealtimeEvent(data: string): RealtimeEvent | null {
  try {
    const o = JSON.parse(data);
    return typeof o === "object" && o !== null ? (o as RealtimeEvent) : null;
  } catch {
    return null;
  }
}

/** A completed `log_evidence` tool call extracted from an event: its call id and the
 *  parsed argument object (or null when the event is not that, or its args are junk). */
export interface ExtractedLogEvidence {
  callId: string | null;
  args: unknown;
}

/**
 * If `event` is a completed `log_evidence` function call, return its call id and
 * parsed arguments; otherwise null. Realtime emits function-call arguments as a
 * JSON STRING on `response.function_call_arguments.done`, so the args are parsed here.
 */
export function extractLogEvidenceCall(event: RealtimeEvent): ExtractedLogEvidence | null {
  const isDone =
    event.type === "response.function_call_arguments.done" || event.type === "response.function_call.done";
  if (!isDone || event.name !== "log_evidence") return null;
  let args: unknown = null;
  if (typeof event.arguments === "string") {
    try {
      args = JSON.parse(event.arguments);
    } catch {
      args = null;
    }
  }
  return { callId: typeof event.call_id === "string" ? event.call_id : null, args };
}

export interface RealtimeHandlers {
  /** Called with the parsed args of each completed `log_evidence` tool call. */
  onLogEvidence: (args: unknown) => void | Promise<void>;
  /** Any other event, for UI (e.g. audio-activity dots). Optional. */
  onEvent?: (event: RealtimeEvent) => void;
}

/** Dispatch one parsed realtime event: forward a `log_evidence` call to the handler,
 *  and pass every event to the optional `onEvent` sink. */
export function dispatchRealtimeEvent(event: RealtimeEvent, handlers: RealtimeHandlers): void {
  handlers.onEvent?.(event);
  const call = extractLogEvidenceCall(event);
  if (call && call.args !== null) void handlers.onLogEvidence(call.args);
}

// ── connection handshake (injectable, unit-tested against fakes) ──────────────

/** Minimal structural shapes so the seam is testable without the DOM WebRTC types. */
export interface DataChannelLike {
  onmessage: ((ev: { data: string }) => void) | null;
  send(data: string): void;
}
export interface TrackLike {
  kind: string;
}
export interface MediaStreamLike {
  getTracks(): TrackLike[];
}
export interface PeerConnectionLike {
  createDataChannel(label: string): DataChannelLike;
  addTrack(track: TrackLike, stream: MediaStreamLike): void;
  createOffer(): Promise<{ sdp?: string; type: string }>;
  setLocalDescription(desc: { sdp?: string; type: string }): Promise<void>;
  setRemoteDescription(desc: { sdp: string; type: string }): Promise<void>;
  ontrack: ((ev: { streams: MediaStreamLike[] }) => void) | null;
  close(): void;
}

export interface TutorConnectDeps {
  clientSecret: string;
  model: string;
  handlers: RealtimeHandlers;
  getMicStream: () => Promise<MediaStreamLike>;
  createPeerConnection: () => PeerConnectionLike;
  /** Exchange the local SDP offer for the remote SDP answer, authorized by the
   *  EPHEMERAL client secret (never the key). Default impl POSTs to the realtime
   *  endpoint; tests inject a fake. */
  exchangeSdp: (offerSdp: string, opts: { clientSecret: string; model: string }) => Promise<string>;
  onRemoteAudio?: (stream: MediaStreamLike) => void;
}

export interface TutorConnection {
  pc: PeerConnectionLike;
  channel: DataChannelLike;
  stop(): void;
}

/**
 * Establish the tutor WebRTC connection: capture mic, create the peer connection and
 * the event data channel, wire `log_evidence` dispatch, and complete the SDP
 * offer/answer handshake using the ephemeral secret. Returns the connection with a
 * `stop()`. Pure orchestration over injected deps — the unit test drives it entirely
 * with fakes; only the default deps touch the real browser/network.
 */
export async function connectTutor(deps: TutorConnectDeps): Promise<TutorConnection> {
  const stream = await deps.getMicStream();
  const pc = deps.createPeerConnection();
  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  const channel = pc.createDataChannel(REALTIME_EVENT_CHANNEL);
  channel.onmessage = (ev) => {
    const event = parseRealtimeEvent(ev.data);
    if (event) dispatchRealtimeEvent(event, deps.handlers);
  };

  pc.ontrack = (ev) => deps.onRemoteAudio?.(ev.streams[0]);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const answerSdp = await deps.exchangeSdp(offer.sdp ?? "", {
    clientSecret: deps.clientSecret,
    model: deps.model,
  });
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    pc,
    channel,
    stop() {
      pc.close();
    },
  };
}

/** The default live SDP exchange: POST the offer to the realtime endpoint authorized
 *  by the EPHEMERAL secret, returning the answer SDP. Used by the browser; never in a
 *  CI test (the live call is operator-gated). */
export async function exchangeSdpOverHttp(
  offerSdp: string,
  opts: { clientSecret: string; model: string },
): Promise<string> {
  const res = await fetch(`${REALTIME_CALLS_URL}?model=${encodeURIComponent(opts.model)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.clientSecret}`, "content-type": "application/sdp" },
    body: offerSdp,
  });
  if (!res.ok) throw new Error(`Realtime SDP exchange failed: ${res.status} ${res.statusText}`);
  return res.text();
}
