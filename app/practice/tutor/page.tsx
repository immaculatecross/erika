"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { DotsField } from "@/components/tutor/dots-field";
import { ConversationProgress } from "@/components/tutor/conversation-progress";
import { toUploadableWav } from "@/lib/recording";
import { uploadAudio } from "@/lib/upload-audio";
import { landConversationTake } from "@/lib/tutor/take";
import { closingLine } from "@/lib/tutor/closing-line";
import { TUTOR_OPENING } from "@/lib/tutor/persona";
import { startFailureMessage } from "@/lib/tutor/failure-message";
import { ReplyChunker } from "@/lib/tutor/reply-stream";
import { SpeechQueue } from "@/lib/tutor/speech-queue";
import {
  connectTutor,
  exchangeSdpOverHttp,
  type MediaStreamLike,
  type PeerConnectionLike,
  type TutorConnection,
} from "@/lib/tutor/realtime-client";

// The Learn-tab spoken tutor (E-34, rebuilt at E-43 for D-28).
//
// HOW A TURN WORKS NOW. The learner speaks; the Realtime session hears them NATIVELY
// (D-3: a transcript erases pronunciation, hesitation and the almost-right word — and
// spike-6 measured `whisper-1` silently repairing this repo's own planted errors); the
// reply comes back as TEXT on the data channel; each finished sentence is spoken
// through TTS in the voice the operator chose. Server VAD ends a turn on silence, so
// the learner presses NOTHING between turns — one button to begin, one to stop, and
// that is the whole interaction.
//
// D-24 and DESIGN hold: a quiet field of dots breathing with the voice, no avatar, no
// waveform, tabular numbers, no countdown and no guilt copy if the learner leaves
// early.

type Phase = "idle" | "connecting" | "live" | "ending" | "refused" | "error";

interface SessionInfo {
  estimateUsd: number;
  remainingUsd: number;
  budgetUsd: number;
  model: string;
  minSeconds: number;
  keyConfigured: boolean;
}

const HEARTBEAT_MS = 20_000;

export default function TutorPage() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const conn = useRef<TutorConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tutorId = useRef<string | null>(null);
  const startedAt = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunker = useRef(new ReplyChunker());
  const voice = useRef<SpeechQueue | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/tutor/session")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(refresh, [refresh]);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (heartbeat.current) clearInterval(heartbeat.current);
    timer.current = null;
    heartbeat.current = null;
    voice.current?.stop();
    voice.current = null;
    conn.current?.stop();
    conn.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    chunker.current.reset();
    setSpeaking(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  async function logEvidence(args: unknown) {
    await fetch("/api/tutor/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }).catch(() => {});
  }

  /** The speaking leg: one fetch per sentence, pipelined, played in order. */
  function makeVoice(id: string): SpeechQueue {
    return new SpeechQueue({
      fetchAudio: async (text, seq, signal) => {
        const res = await fetch("/api/tutor/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tutorId: id, seq, text }),
          signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? "Erika could not speak just now.");
        }
        return res.blob();
      },
      play: (clip, signal) =>
        new Promise<void>((resolve) => {
          const el = audioEl.current ?? new Audio();
          audioEl.current = el;
          const url = URL.createObjectURL(clip);
          const done = () => {
            URL.revokeObjectURL(url);
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          const onAbort = () => {
            el.pause();
            done();
          };
          signal.addEventListener("abort", onAbort, { once: true });
          el.onended = done;
          el.onerror = done;
          el.src = url;
          void el.play().catch(done);
        }),
      onSpeakingChange: setSpeaking,
      onError: (m) => setMessage(m),
    });
  }

  async function start() {
    setMessage(null);
    setClosing(null);
    setPhase("connecting");
    try {
      const res = await fetch("/api/tutor/session", { method: "POST" });
      const body = await res.json();
      if (res.status === 402) {
        setPhase("refused");
        setMessage(body?.error?.message ?? "The monthly budget cannot cover a conversation right now.");
        return;
      }
      if (!res.ok) throw new Error(body?.error?.message ?? "Erika could not start a conversation.");

      tutorId.current = body.tutorId;
      // Echo cancellation matters here specifically: the mic stays open while Erika
      // speaks so the learner can talk over her, and without AEC her own voice would
      // come back as a learner turn.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = mic;

      // Record the take locally so it lands as a normal session on end.
      chunks.current = [];
      const rec = new MediaRecorder(mic);
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.start(1000);
      recorder.current = rec;

      const queue = makeVoice(body.tutorId);
      voice.current = queue;
      chunker.current.reset();

      conn.current = await connectTutor({
        clientSecret: body.clientSecret,
        model: body.model,
        greeting: TUTOR_OPENING,
        getMicStream: async () => mic as unknown as MediaStreamLike,
        createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnectionLike,
        exchangeSdp: exchangeSdpOverHttp,
        handlers: {
          onLogEvidence: logEvidence,
          onTextDelta: (delta) => {
            for (const sentence of chunker.current.push(delta)) queue.speak(sentence);
          },
          onTurnComplete: () => {
            const rest = chunker.current.flush();
            if (rest) queue.speak(rest);
            chunker.current.reset();
          },
          // Barge-in: the learner talking cancels Erika's voice at once.
          onSpeechStarted: () => queue.stop(),
        },
      });

      startedAt.current = Date.now();
      setElapsedMs(0);
      setPhase("live");
      timer.current = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 500);
      heartbeat.current = setInterval(() => {
        void fetch(`/api/tutor/session/${tutorId.current}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elapsedSeconds: (Date.now() - startedAt.current) / 1000 }),
        })
          .then((r) => r.json())
          .then((b) => {
            if (b && b.covered === false) void stop();
          })
          .catch(() => {});
      }, HEARTBEAT_MS);
    } catch (err) {
      setPhase("error");
      setMessage(startFailureMessage(err, info));
      cleanup();
    }
  }

  const stop = useCallback(async () => {
    if (phase !== "live") return;
    setPhase("ending");
    const elapsedSeconds = (Date.now() - startedAt.current) / 1000;
    const id = tutorId.current;

    // Stop heart-beating BEFORE the wind-down's awaits (the take is assembled and
    // uploaded first, which can take seconds). A heartbeat that fires in that window
    // would land at the server after `/end` has finalized the lease. The server refuses
    // such a heartbeat outright (`session_closed`) — that is the real fix for the
    // double-charge race, since a request already on the wire cannot be recalled — but
    // there is no reason to keep firing them once the user has ended the call.
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
    voice.current?.stop();

    // Stop recording and assemble the take.
    const rec = recorder.current;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () => resolve(new Blob(chunks.current, { type: chunks.current[0]?.type || "audio/webm" }));
      rec.stop();
    });
    recorder.current = null;

    // Land the recording as a normal session (→ ingest → deep analysis), converted to
    // WAV first so the server can probe its duration — a raw MediaRecorder container
    // has none and is refused 422 (lib/tutor/take.ts). `capturedAt` is the instant the
    // conversation began, which is also how the server links this recording to the
    // conversation record (E-42's v28 column).
    const landed = await landConversationTake({
      blob,
      capturedAt: new Date(startedAt.current),
      toWav: toUploadableWav,
      upload: uploadAudio,
    });

    // Finalize the money lease and close the durable conversation record.
    if (id) {
      const closed = await fetch(`/api/tutor/session/${id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elapsedSeconds }),
      })
        .then((r) => r.json())
        .catch(() => null);
      // Factual, once, and silent when the minimum was not reached — leaving early
      // costs nothing and is told nothing (D-24).
      // Factual, once. What it says depends on what actually happened to the take —
      // never a cheerful line over a recording that was refused.
      setClosing(closingLine(closed?.metMinimum === true, landed));
    }

    cleanup();
    tutorId.current = null;
    setPhase("idle");
    refresh();
  }, [phase, cleanup, refresh]);

  // A closed tab is the common way a conversation ends without the button. The beacon
  // carries the client's own elapsed time so the record closes honestly rather than
  // being written off as an unknown by the abandoned-conversation sweep.
  useEffect(() => {
    const onHide = () => {
      const id = tutorId.current;
      if (!id || phase !== "live") return;
      navigator.sendBeacon?.(
        `/api/tutor/session/${id}/end`,
        new Blob([JSON.stringify({ elapsedSeconds: (Date.now() - startedAt.current) / 1000 })], {
          type: "application/json",
        }),
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [phase]);

  const live = phase === "live" || phase === "ending";
  const minSeconds = info?.minSeconds ?? 0;

  return (
    <div data-tutor className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <Link href="/practice" className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink">
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Today
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[34px] font-bold tracking-tight">Conversation</h1>
        <p className="mt-1 text-[17px] text-secondary">
          Speak Italian with Erika. She listens to how you actually say it, corrects one thing at a
          time, and records the whole thing like any other session — so it still becomes findings.
        </p>
      </header>

      <section className="flex flex-col items-center gap-6 rounded-card bg-card p-8 shadow-card">
        <DotsField active={live} intensity={speaking ? 0.9 : 0.4} />

        {live ? (
          <>
            <ConversationProgress elapsedMs={elapsedMs} minSeconds={minSeconds} />
            <p className="text-[13px] text-secondary" data-tutor-turn aria-live="polite">
              {speaking ? "Erika is speaking" : "Listening — just talk"}
            </p>
          </>
        ) : info ? (
          <p className="tabular text-[15px] text-secondary" data-tutor-ready>
            {minSeconds > 0
              ? `${Math.round(minSeconds / 60)} minutes of conversation counts toward your day.`
              : "A spoken conversation, steered toward your own recurring mistakes."}
          </p>
        ) : (
          <p className="text-[15px] text-secondary">Preparing…</p>
        )}

        {live ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={phase === "ending"}
            className="rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {phase === "ending" ? "Wrapping up…" : "End conversation"}
          </button>
        ) : (
          <motion.button
            type="button"
            onClick={() => void start()}
            disabled={phase === "connecting"}
            className="rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {phase === "connecting" ? "Connecting…" : "Start talking"}
          </motion.button>
        )}

        {closing && !live && (
          <p className="max-w-sm text-center text-[13px] text-secondary" role="status" data-tutor-closing>
            {closing}
          </p>
        )}

        {message && (
          <p className="max-w-sm text-center text-[13px] text-secondary" role="status" data-tutor-message>
            {message}{" "}
            {info && !info.keyConfigured && (
              <Link href="/settings" className="underline underline-offset-2 hover:text-ink">
                Open Settings
              </Link>
            )}
          </p>
        )}
      </section>
    </div>
  );
}
