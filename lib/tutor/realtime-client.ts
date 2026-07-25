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

// ── the reply, as AUDIO (E-43, Amendment 5) ──────────────────────────────────
//
// With `output_modalities: ["audio"]` the tutor's voice arrives on the WebRTC MEDIA
// track, not on this data channel — `pc.ontrack` below — so nothing here has to
// assemble, chunk or queue it. The data channel still carries the events, and two of
// them are all the UI needs to say whose turn it is.
//
// The GA audio-delta event is `response.output_audio.delta`; the beta lineage used
// `response.audio.delta`. spike-7 §2 MEASURED that only the GA name arrives on this
// account, but a matcher on the suffix costs nothing and cannot leave the turn line
// stuck on the wrong state if the naming moves — the same reasoning the mint allowlist
// earns its comment with.

/** Whether this event is a piece of the tutor's spoken reply — the cue that Erika has
 *  started (or is still) speaking. The audio itself never passes through here; this is
 *  only the signal that it is flowing. */
export function isAudioDelta(event: RealtimeEvent): boolean {
  return typeof event.type === "string" && event.type.endsWith("audio.delta");
}

/** Whether this event says the tutor has finished its turn. */
export function isResponseComplete(event: RealtimeEvent): boolean {
  return event.type === "response.done" || event.type === "response.completed";
}

/** Whether this event says the LEARNER has started speaking. Under audio-out the
 *  barge-in itself is the SERVER's job (`interrupt_response` in TUTOR_TURN_DETECTION
 *  cancels the reply upstream), so this is a UI signal only — it flips the turn line
 *  back to "listening" the instant the learner talks over Erika. */
export function isSpeechStarted(event: RealtimeEvent): boolean {
  return event.type === "input_audio_buffer.speech_started";
}

export interface RealtimeHandlers {
  /** Called with the parsed args of each completed `log_evidence` tool call, and the
   *  `call_id` the model expects an answer on. */
  onLogEvidence: (args: unknown, callId: string | null) => void | Promise<void>;
  /** The tutor has begun speaking this turn. */
  onSpeakingStarted?: () => void;
  /** The tutor has finished this turn. */
  onTurnComplete?: () => void;
  /** The learner started speaking. */
  onSpeechStarted?: () => void;
  /** Any other event, for UI (e.g. the dots field). Optional. */
  onEvent?: (event: RealtimeEvent) => void;
}

/** Dispatch one parsed realtime event to the handlers that care about it. */
export function dispatchRealtimeEvent(event: RealtimeEvent, handlers: RealtimeHandlers): void {
  handlers.onEvent?.(event);
  if (isAudioDelta(event)) handlers.onSpeakingStarted?.();
  if (isResponseComplete(event)) handlers.onTurnComplete?.();
  if (isSpeechStarted(event)) handlers.onSpeechStarted?.();
  const call = extractLogEvidenceCall(event);
  if (call && call.args !== null) void handlers.onLogEvidence(call.args, call.callId);
}

// ── ANSWERING THE TOOL CALL — the turn that used to go missing ───────────────
//
// 🚩 A LOGGED PIECE OF EVIDENCE USED TO COST THE LEARNER THE CORRECTION IT CAME FROM.
//
// `extractLogEvidenceCall` has always returned a `call_id`, and until now every caller
// threw it away: the browser POSTed the args to /api/tutor/evidence and sent the model
// nothing back. A Realtime function call is a REQUEST — the model emits a short holding
// line while the call is in flight and then waits for `function_call_output` before
// finishing its turn. With no answer it waits forever.
//
// So on every turn where the tutor logged evidence, the learner heard the holding line
// — "Un momento, ti rispondo con una correzione mirata e poi proseguiamo" — and then
// silence, and the correction itself was never spoken. MEASURED on this branch, 9
// labelled fixtures on the shipping configuration: 5 of 9 replies were a holding line
// and nothing else, every one of them on a turn that called `log_evidence`. Answering
// the call turns the same fixture into "Hai detto 'ieri ho andato al cinema': l'errore
// è nell'ausiliare, con 'andare' si usa essere, quindi 'ieri sono andato al cinema'."
//
// It is worth being precise about why this was invisible. It is not a persona problem
// and the "never narrate your tools" line cannot fix it — the holding line is the
// CORRECT behaviour of a model that expects to continue. It is not a rate problem, a
// transport problem or a UI problem. It is a protocol half-implemented, and every unit
// test passed because they all assert what the app does with the args.

/** The event that hands a tool call's result back to the model. Pure, so the wire
 *  shape is unit-testable without a channel. */
export function functionCallOutput(callId: string, output: unknown): Record<string, unknown> {
  return {
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
  };
}

/** Ask the model to produce the turn it was holding. Sent only after the holding
 *  response has finished — `response.create` while one is still streaming is an error
 *  (`conversation_already_has_active_response`). */
export function continueResponse(): Record<string, unknown> {
  return { type: "response.create" };
}

/** At most this many continuations per learner turn. One is what the protocol needs;
 *  a bound is what stops a model that logs evidence in its continuation from driving
 *  an unbounded chain of billed responses off a single learner sentence. */
export const MAX_CONTINUATIONS_PER_TURN = 1;

// ── connection handshake (injectable, unit-tested against fakes) ──────────────

/** Minimal structural shapes so the seam is testable without the DOM WebRTC types. */
export interface DataChannelLike {
  onmessage: ((ev: { data: string }) => void) | null;
  onopen?: (() => void) | null;
  send(data: string): void;
}

/** The `response.create` event that makes Erika speak first. Pure, so the wire shape
 *  is unit-tested without a channel. */
export function openingResponse(instructions: string): Record<string, unknown> {
  return { type: "response.create", response: { instructions } };
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
  /** The tutor's voice arrives here, as a remote media track. */
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
  /** Sent on the event channel once the channel opens, if given — this is how Erika
   *  speaks FIRST. Without it a learner who has never seen this app is left staring at
   *  a silent screen wondering whose turn it is. */
  greeting?: string;
  /** The tutor's voice, as a remote media stream, the moment the track arrives. The
   *  caller attaches it to an `<audio>` element; nothing here touches the DOM. */
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

  // Answering the tool call belongs HERE, not in the page: it is part of the protocol,
  // it must happen whatever the app does with the evidence, and it must not wait on the
  // server round-trip that persists it. See the block above for what happens without it.
  let owed = false;
  let continuations = 0;
  const handlers: RealtimeHandlers = {
    ...deps.handlers,
    onLogEvidence: (args, callId) => {
      if (callId && continuations < MAX_CONTINUATIONS_PER_TURN) {
        channel.send(JSON.stringify(functionCallOutput(callId, { ok: true })));
        owed = true;
      }
      return deps.handlers.onLogEvidence(args, callId);
    },
    onTurnComplete: () => {
      if (owed) {
        owed = false;
        continuations += 1;
        channel.send(JSON.stringify(continueResponse()));
      }
      deps.handlers.onTurnComplete?.();
    },
    onSpeechStarted: () => {
      // A new learner turn: the budget of continuations resets, and anything owed by
      // the turn the learner just interrupted is abandoned rather than spoken over.
      continuations = 0;
      owed = false;
      deps.handlers.onSpeechStarted?.();
    },
  };

  channel.onmessage = (ev) => {
    const event = parseRealtimeEvent(ev.data);
    if (event) dispatchRealtimeEvent(event, handlers);
  };
  // Erika opens the conversation. `deps.greeting` is an instruction for the FIRST
  // response only; the persona still governs everything after it.
  if (deps.greeting) {
    channel.onopen = () => channel.send(JSON.stringify(openingResponse(deps.greeting as string)));
  }

  // The tutor's voice comes DOWN this connection as a media track. Wired before the
  // offer, because the track can arrive as soon as the remote description is set.
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
