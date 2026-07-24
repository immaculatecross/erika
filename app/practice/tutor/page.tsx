"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { DotsField } from "@/components/tutor/dots-field";
import { formatUsd } from "@/lib/format";
import { formatElapsed, recordingFilename } from "@/lib/recording";
import { SUPPORTED_FORMATS, type AudioFormat } from "@/lib/session-types";
import { uploadAudio } from "@/lib/upload-audio";
import {
  connectTutor,
  exchangeSdpOverHttp,
  type MediaStreamLike,
  type PeerConnectionLike,
  type TutorConnection,
} from "@/lib/tutor/realtime-client";

// The Learn-tab spoken tutor (E-34, D-24). One calm surface: the dots field breathing
// with the voice, a per-session estimate, a plain start/stop, an elapsed timer in
// tabular numerals — no avatar, no waveform. The call records locally and, on end,
// lands as a NORMAL session through the same upload→ingest path as any capture
// (uploadAudio), so its findings are the one truth (E-17). The live WebRTC connection
// is the operator-gated step (needs a configured key + network); a failure here is a
// quiet, honest line, never a dead control.

type Phase = "idle" | "connecting" | "live" | "ending" | "refused" | "error";

interface Estimate {
  estimateUsd: number;
  remainingUsd: number;
  budgetUsd: number;
  model: string;
}

const HEARTBEAT_MS = 20_000;

export default function TutorPage() {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0.4);

  const conn = useRef<TutorConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tutorId = useRef<string | null>(null);
  const startedAt = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/tutor/session")
      .then((r) => r.json())
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, []);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (heartbeat.current) clearInterval(heartbeat.current);
    timer.current = null;
    heartbeat.current = null;
    conn.current?.stop();
    conn.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  async function logEvidence(args: unknown) {
    await fetch("/api/tutor/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }).catch(() => {});
  }

  async function start() {
    setMessage(null);
    setPhase("connecting");
    try {
      const res = await fetch("/api/tutor/session", { method: "POST" });
      const body = await res.json();
      if (res.status === 402) {
        setPhase("refused");
        setMessage(body?.error?.message ?? "The monthly budget cannot cover a session right now.");
        return;
      }
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not start the tutor.");

      tutorId.current = body.tutorId;
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = mic;

      // Record the take locally so it lands as a normal session on end.
      chunks.current = [];
      const rec = new MediaRecorder(mic);
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.start(1000);
      recorder.current = rec;

      conn.current = await connectTutor({
        clientSecret: body.clientSecret,
        model: body.model,
        getMicStream: async () => mic as unknown as MediaStreamLike,
        createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnectionLike,
        exchangeSdp: exchangeSdpOverHttp,
        handlers: {
          onLogEvidence: logEvidence,
          onEvent: (ev) => {
            if (typeof ev.type === "string" && ev.type.includes("audio")) setLevel((l) => Math.min(1, l + 0.15));
            else setLevel((l) => Math.max(0.35, l - 0.05));
          },
        },
        onRemoteAudio: (s) => {
          const el = new Audio();
          el.srcObject = s as unknown as MediaStream;
          void el.play().catch(() => {});
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
      setMessage(
        (err as Error).message ??
          "The live tutor needs a configured key and network — this is an operator-gated step.",
      );
      cleanup();
    }
  }

  const stop = useCallback(async () => {
    if (phase !== "live") return;
    setPhase("ending");
    const elapsedSeconds = (Date.now() - startedAt.current) / 1000;
    const id = tutorId.current;

    // Stop recording and assemble the take.
    const rec = recorder.current;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () => resolve(new Blob(chunks.current, { type: chunks.current[0]?.type || "audio/webm" }));
      rec.stop();
    });
    recorder.current = null;

    // Land the recording as a normal session (→ ingest → deep analysis).
    if (blob && blob.size > 0) {
      const raw = (blob.type.split("/")[1] || "webm").split(";")[0];
      const ext: AudioFormat = (SUPPORTED_FORMATS as readonly string[]).includes(raw) ? (raw as AudioFormat) : "webm";
      await uploadAudio(recordingFilename(ext), blob).catch(() => {});
    }

    // Finalize the money lease to actual.
    if (id) {
      await fetch(`/api/tutor/session/${id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elapsedSeconds }),
      }).catch(() => {});
    }

    cleanup();
    tutorId.current = null;
    setPhase("idle");
    // Refresh the estimate/remaining after a finalized session.
    fetch("/api/tutor/session").then((r) => r.json()).then(setEstimate).catch(() => {});
  }, [phase, cleanup]);

  const live = phase === "live" || phase === "ending";

  return (
    <div data-tutor className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <Link href="/practice" className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink">
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Today
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[34px] font-bold tracking-tight">Tutor</h1>
        <p className="mt-1 text-[17px] text-secondary">
          A spoken conversation, steered toward your own recurring mistakes. It records like any session,
          so what you say still becomes findings.
        </p>
      </header>

      <section className="flex flex-col items-center gap-6 rounded-card bg-card p-8 shadow-card">
        <DotsField active={live} intensity={live ? level : 0.4} />

        {live ? (
          <p data-tutor-timer className="tabular text-[22px] font-semibold text-ink" aria-label="Elapsed">
            {formatElapsed(elapsedMs)}
          </p>
        ) : estimate ? (
          <p className="tabular text-[15px] text-secondary" data-tutor-estimate>
            About {formatUsd(estimate.estimateUsd)} for a session · {formatUsd(estimate.remainingUsd)} left this month
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

        {message && (
          <p
            className={`max-w-sm text-center text-[13px] ${phase === "refused" ? "text-secondary" : "text-secondary"}`}
            role="status"
            data-tutor-message
          >
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
