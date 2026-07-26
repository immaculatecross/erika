import type { RealtimeTurnUsage } from "../analysis/rates";

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

/** Text-only Realtime replies arrive as GA `response.output_text.delta` events. */
export function extractTextDelta(event: RealtimeEvent): string | null {
  if (typeof event.type !== "string" || !event.type.endsWith("text.delta")) return null;
  return typeof event.delta === "string" ? event.delta : null;
}

/** Normalize the usage object carried on `response.done`; no secret-bearing fields
 * leave the data channel. */
export function extractRealtimeUsage(event: RealtimeEvent): RealtimeTurnUsage | null {
  if (!isResponseComplete(event)) return null;
  const response =
    typeof event.response === "object" && event.response !== null
      ? (event.response as Record<string, unknown>)
      : null;
  const usage =
    response && typeof response.usage === "object" && response.usage !== null
      ? (response.usage as Record<string, unknown>)
      : null;
  if (!usage) return null;
  const inputDetails =
    typeof usage.input_token_details === "object" && usage.input_token_details !== null
      ? (usage.input_token_details as Record<string, unknown>)
      : typeof usage.input_tokens_details === "object" && usage.input_tokens_details !== null
        ? (usage.input_tokens_details as Record<string, unknown>)
        : {};
  const cachedDetails =
    typeof inputDetails.cached_tokens_details === "object" &&
    inputDetails.cached_tokens_details !== null
      ? (inputDetails.cached_tokens_details as Record<string, unknown>)
      : {};
  const outputDetails =
    typeof usage.output_token_details === "object" && usage.output_token_details !== null
      ? (usage.output_token_details as Record<string, unknown>)
      : typeof usage.output_tokens_details === "object" && usage.output_tokens_details !== null
        ? (usage.output_tokens_details as Record<string, unknown>)
        : {};
  return {
    inputTokens: Number(usage.input_tokens) || 0,
    cachedInputTokens: Number(inputDetails.cached_tokens) || 0,
    audioInputTokens: Number(inputDetails.audio_tokens) || 0,
    cachedAudioInputTokens: Number(cachedDetails.audio_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    reasoningTokens: Number(outputDetails.reasoning_tokens) || 0,
  };
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

/**
 * Whether this event says Erika has STARTED SPEAKING.
 *
 * ⚠️ `response.output_audio.delta` DOES NOT ARRIVE OVER WebRTC, and assuming it did
 * was a real defect — found by driving the built app, not by reading. Over a WebSocket
 * the audio is base64 on the event stream, so a delta event is the natural signal;
 * over WebRTC the audio is on the MEDIA TRACK and the data channel carries only
 * `output_audio_buffer.started` / `.stopped` around it. A full 45-second browser
 * session emitted `output_audio_buffer.started`, `response.output_audio.done` and
 * `response.output_audio_transcript.delta` — and not one `response.output_audio.delta`
 * [MEASURED]. So the turn line sat on "Listening — just talk" while Erika was audibly
 * talking.
 *
 * All three signals are accepted, because this product may yet speak over either
 * transport and a turn line that is silently wrong is worse than a noisy one: the
 * WebRTC buffer event, the transcript delta (which accompanies the audio on both), and
 * the WebSocket-shaped audio delta.
 */
export function isSpeakingStarted(event: RealtimeEvent): boolean {
  const t = event.type;
  if (typeof t !== "string") return false;
  return t === "output_audio_buffer.started" || t.endsWith("audio_transcript.delta") || t.endsWith("output_audio.delta");
}

/**
 * Whether this event closes the RESPONSE — the protocol signal, and deliberately NOT
 * the playback one. The continuation (`response.create`) is gated on this, and sending
 * it while a response is still active is an API error, so `output_audio_buffer.stopped`
 * — which is about the audio buffer draining, not the response resolving — must not
 * appear here. It drives the turn line instead, through `isSpeakingStopped`.
 */
export function isResponseComplete(event: RealtimeEvent): boolean {
  return event.type === "response.done" || event.type === "response.completed";
}

/** Whether Erika's audio has STOPPED playing — a UI signal only (see above). */
export function isSpeakingStopped(event: RealtimeEvent): boolean {
  return event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared";
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
  /** The tutor's audio has stopped playing (UI only, not the protocol's turn end). */
  onSpeakingStopped?: () => void;
  /** The tutor's RESPONSE has closed — the protocol's turn end. */
  onTurnComplete?: () => void;
  /** The learner started speaking. */
  onSpeechStarted?: () => void;
  /** One complete text-only response, with usage when the provider supplied it. */
  onTurnText?: (text: string, usage: RealtimeTurnUsage | null) => void;
  /** Any other event, for UI (e.g. the dots field). Optional. */
  onEvent?: (event: RealtimeEvent) => void;
}

/** Dispatch one parsed realtime event to the handlers that care about it. */
export function dispatchRealtimeEvent(event: RealtimeEvent, handlers: RealtimeHandlers): void {
  handlers.onEvent?.(event);
  if (isSpeakingStarted(event)) handlers.onSpeakingStarted?.();
  if (isSpeakingStopped(event)) handlers.onSpeakingStopped?.();
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
  readyState?: string;
  send(data: string): void;
}

/** The `response.create` event that makes Erika speak first. Pure, so the wire shape
 *  is unit-tested without a channel. */
export function openingResponse(instructions: string): Record<string, unknown> {
  return { type: "response.create", response: { instructions } };
}

export function manualTurnEvents(): readonly [Record<string, unknown>, Record<string, unknown>] {
  return [
    { type: "input_audio_buffer.commit" },
    { type: "response.create", response: { output_modalities: ["text"] } },
  ];
}

export function repairResponse(invalid: string): Record<string, unknown> {
  return {
    type: "response.create",
    response: {
      output_modalities: ["text"],
      instructions:
        "Your previous response was invalid. Return only one complete JSON object in the required schema. " +
        "The first character must be { and the last must be }; add no parentheses, fences, label, or commentary. " +
        `Do not add new claims. Previous response: ${invalid.slice(0, 6000)}`,
    },
  };
}
export interface TrackLike {
  kind: string;
  enabled?: boolean;
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
  beginTurn(): boolean;
  commitTurn(): boolean;
  requestRepair(invalid: string): boolean;
  isRecording(): boolean;
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
  const tracks = stream.getTracks();
  for (const track of tracks) {
    // Manual turns are closed by default. The model receives audio only after the
    // learner explicitly presses Speak.
    track.enabled = false;
    pc.addTrack(track, stream);
  }

  const channel = pc.createDataChannel(REALTIME_EVENT_CHANNEL);
  const pending: string[] = [];
  const send = (event: Record<string, unknown>) => {
    const serialized = JSON.stringify(event);
    if (channel.readyState && channel.readyState !== "open") pending.push(serialized);
    else channel.send(serialized);
  };

  let recording = false;
  let processing = false;
  let repairs = 0;
  let text = "";

  channel.onmessage = (ev) => {
    const event = parseRealtimeEvent(ev.data);
    if (!event) return;
    const delta = extractTextDelta(event);
    if (delta) text += delta;
    if (isResponseComplete(event)) {
      processing = false;
      const complete = text;
      text = "";
      deps.handlers.onTurnText?.(complete, extractRealtimeUsage(event));
    }
    dispatchRealtimeEvent(event, deps.handlers);
  };
  channel.onopen = () => {
    for (const event of pending.splice(0)) channel.send(event);
    if (deps.greeting) channel.send(JSON.stringify(openingResponse(deps.greeting)));
  };

  // Text-only sessions should never produce a remote audio track; retaining the
  // callback makes an unexpected provider regression observable.
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
    beginTurn() {
      if (recording || processing) return false;
      recording = true;
      repairs = 0;
      text = "";
      for (const track of tracks) track.enabled = true;
      return true;
    },
    commitTurn() {
      if (!recording || processing) return false;
      recording = false;
      processing = true;
      for (const track of tracks) track.enabled = false;
      const [commit, create] = manualTurnEvents();
      send(commit);
      send(create);
      return true;
    },
    requestRepair(invalid) {
      if (recording || processing || repairs >= 1) return false;
      repairs += 1;
      processing = true;
      text = "";
      send(repairResponse(invalid));
      return true;
    },
    isRecording() {
      return recording;
    },
    stop() {
      for (const track of tracks) track.enabled = false;
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
