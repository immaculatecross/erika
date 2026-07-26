"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoticeReason } from "../session/notices";
import { toUploadableWav } from "../recording";
import { uploadAudio } from "../upload-audio";
import { closingLine, costLine } from "./closing-line";
import { landConversationTake } from "./take";
import {
  DEFAULT_TUTOR_ARCHITECTURE,
  DEFAULT_TUTOR_PRESET,
  type TutorArchitecture,
  type TutorPromptPreset,
} from "./experiment";
import {
  connectTutor,
  exchangeSdpOverHttp,
  type MediaStreamLike,
  type PeerConnectionLike,
  type TutorConnection,
} from "./realtime-client";
import { realtimeTurnUsageCost, REALTIME_FLAGSHIP, type RealtimeTurnUsage } from "../analysis/rates";
import {
  parseTutorTurnResult,
  TURN_RECOVERY_MESSAGE,
  TutorTurnParseError,
  type ParsedTutorTurn,
} from "./turn-result";
import { playTutorSpeechStream } from "./streaming-audio";
import type { TutorTurnDetails } from "@/components/tutor/turn-details";

export type TutorPhase = "idle" | "connecting" | "live" | "ending" | "refused" | "error";
export type TutorTurnPhase = "ready" | "recording" | "processing";

export interface TutorSessionInfo {
  estimateUsd: number;
  remainingUsd: number;
  budgetUsd: number;
  model: string;
  minSeconds: number;
  keyConfigured: boolean;
}

interface StartResponse {
  tutorId: string;
  architecture: TutorArchitecture;
  preset: TutorPromptPreset;
  promptHash: string;
  clientSecret?: string;
  model: string;
}

const HEARTBEAT_MS = 20_000;

async function stopRecorder(
  recorder: MediaRecorder | null,
  chunks: Blob[],
): Promise<Blob | null> {
  if (!recorder || recorder.state === "inactive") return null;
  return new Promise((resolve) => {
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: chunks[0]?.type || recorder.mimeType || "audio/webm" }));
    recorder.stop();
  });
}

export function useTutorLab() {
  const [info, setInfo] = useState<TutorSessionInfo | null>(null);
  const [phase, setPhase] = useState<TutorPhase>("idle");
  const [turnPhase, setTurnPhase] = useState<TutorTurnPhase>("ready");
  const [architecture, setArchitecture] = useState<TutorArchitecture>(DEFAULT_TUTOR_ARCHITECTURE);
  const [preset, setPreset] = useState<TutorPromptPreset>(DEFAULT_TUTOR_PRESET);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeReason | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const [lastTurn, setLastTurn] = useState<TutorTurnDetails | null>(null);

  const connection = useRef<TutorConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const modelStream = useRef<MediaStream | null>(null);
  const fullRecorder = useRef<MediaRecorder | null>(null);
  const fullChunks = useRef<Blob[]>([]);
  const turnRecorder = useRef<MediaRecorder | null>(null);
  const turnChunks = useRef<Blob[]>([]);
  const tutorId = useRef<string | null>(null);
  const startedAt = useRef(0);
  const doneAt = useRef(0);
  const nativeCaptureCommitMs = useRef(0);
  const promptHash = useRef("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnBusy = useRef(false);
  const turnSeq = useRef(0);
  const repairCount = useRef(0);
  const nativeTurnUsageUsd = useRef(0);
  const nativeSessionUsageUsd = useRef(0);
  const context = useRef<{ learner: string; tutor: string }[]>([]);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(() => {
    fetch("/api/tutor/session")
      .then((response) => response.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(refresh, [refresh]);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (heartbeat.current) clearInterval(heartbeat.current);
    timer.current = null;
    heartbeat.current = null;
    connection.current?.stop();
    connection.current = null;
    modelStream.current?.getTracks().forEach((track) => track.stop());
    modelStream.current = null;
    mic.current?.getTracks().forEach((track) => track.stop());
    mic.current = null;
    turnBusy.current = false;
    setTurnPhase("ready");
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const writeEvidence = useCallback(async (parsed: ParsedTutorTurn): Promise<string[]> => {
    const rejected: string[] = [];
    for (const item of parsed.result.evidence) {
      const response = await fetch("/api/tutor/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item),
      }).catch(() => null);
      if (!response?.ok) rejected.push(item.itemId);
    }
    return rejected;
  }, []);

  const completeTurn = useCallback(
    async (input: {
      parsed: ParsedTutorTurn;
      transcript?: string;
      captureCommitMs: number;
      transcriptionMs?: number;
      modelMs?: number;
      realtimeUsd?: number;
      transcriptionUsd?: number;
      modelUsd?: number;
    }) => {
      const id = tutorId.current;
      if (!id) return;
      const speechStarted = performance.now();
      const response = await fetch("/api/tutor/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tutorId: id,
          seq: turnSeq.current,
          text: input.parsed.result.reply,
        }),
      });
      const playback = await playTutorSpeechStream(response);
      const firstTtsAudioMs = performance.now() - speechStarted;
      const rejected = await writeEvidence(input.parsed);
      await playback.finished;
      const totalMs = performance.now() - doneAt.current;
      const baseUsd =
        (input.realtimeUsd ?? 0) +
        (input.transcriptionUsd ?? 0) +
        (input.modelUsd ?? 0);
      const totalUsd = baseUsd + playback.modelledCostUsd;
      setLastTurn({
        architecture,
        preset,
        promptHash: promptHash.current,
        transcript: input.transcript,
        errors: input.parsed.result.errors,
        droppedErrors: input.parsed.droppedErrors,
        reply: input.parsed.result.reply,
        evidenceRejected: rejected,
        latency: {
          captureCommitMs: input.captureCommitMs,
          transcriptionMs: input.transcriptionMs,
          modelMs: input.modelMs,
          firstTtsAudioMs,
          totalMs,
        },
        costs: {
          realtimeUsd: input.realtimeUsd,
          transcriptionUsd: input.transcriptionUsd,
          modelUsd: input.modelUsd,
          ttsUsd: playback.modelledCostUsd,
          totalUsd,
          // TTS exposes a conservative reservation while the stream is open. Until a
          // usage endpoint exists, the combined turn must be labelled modelled.
          kind: "modelled",
        },
      });
      if (input.transcript) {
        context.current.push({ learner: input.transcript, tutor: input.parsed.result.reply });
      }
      setMessage(null);
      turnBusy.current = false;
      setTurnPhase("ready");
    },
    [architecture, preset, writeEvidence],
  );

  const failTurn = useCallback((text: string) => {
    setMessage(text);
    turnBusy.current = false;
    setTurnPhase("ready");
  }, []);

  const handleNativeText = useCallback(
    (raw: string, usage: RealtimeTurnUsage | null) => {
      const usageUsd = usage ? realtimeTurnUsageCost(REALTIME_FLAGSHIP, usage).totalUsd : 0;
      nativeTurnUsageUsd.current += usageUsd;
      nativeSessionUsageUsd.current += usageUsd;
      try {
        const parsed = parseTutorTurnResult(raw, { allowPronunciation: true });
        const modelMs = performance.now() - doneAt.current;
        void completeTurn({
          parsed,
          captureCommitMs: nativeCaptureCommitMs.current,
          modelMs,
          realtimeUsd: nativeTurnUsageUsd.current,
        }).catch((error) => failTurn((error as Error).message));
      } catch (error) {
        if (
          error instanceof TutorTurnParseError &&
          repairCount.current === 0 &&
          connection.current?.requestRepair(raw)
        ) {
          repairCount.current = 1;
          return;
        }
        failTurn(TURN_RECOVERY_MESSAGE);
      }
    },
    [completeTurn, failTurn],
  );

  const start = useCallback(async () => {
    setMessage(null);
    setNotice(null);
    setClosing(null);
    setCost(null);
    setLastTurn(null);
    setPhase("connecting");
    try {
      const response = await fetch("/api/tutor/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ architecture, preset }),
      });
      const body = (await response.json()) as StartResponse & {
        error?: { message?: string };
        notice?: NoticeReason;
      };
      if (!response.ok) {
        setPhase(response.status === 402 ? "refused" : "error");
        setMessage(body.error?.message ?? null);
        setNotice(body.notice ?? (response.status === 402 ? "budget" : "conversation-transient"));
        return;
      }
      tutorId.current = body.tutorId;
      promptHash.current = body.promptHash;
      turnSeq.current = 0;
      context.current = [];
      nativeSessionUsageUsd.current = 0;

      const localMic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mic.current = localMic;
      fullChunks.current = [];
      const recorder = new MediaRecorder(localMic);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) fullChunks.current.push(event.data);
      };
      recorder.start(1000);
      fullRecorder.current = recorder;

      if (architecture === "native") {
        const clones = localMic.getAudioTracks().map((track) => track.clone());
        const outbound = new MediaStream(clones);
        modelStream.current = outbound;
        connection.current = await connectTutor({
          clientSecret: body.clientSecret ?? "",
          model: body.model,
          handlers: {
            onLogEvidence: () => {},
            onTurnText: handleNativeText,
          },
          getMicStream: async () => outbound as unknown as MediaStreamLike,
          createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnectionLike,
          exchangeSdp: exchangeSdpOverHttp,
        });
      }

      startedAt.current = Date.now();
      setElapsedMs(0);
      setTurnPhase("ready");
      setPhase("live");
      timer.current = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 500);
      if (architecture === "native") {
        heartbeat.current = setInterval(() => {
          void fetch(`/api/tutor/session/${tutorId.current}/heartbeat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ elapsedSeconds: (Date.now() - startedAt.current) / 1000 }),
          })
            .then((result) => result.json())
            .then((result) => {
              if (result?.covered === false) void stopRef.current();
            })
            .catch(() => {});
        }, HEARTBEAT_MS);
      }
    } catch (error) {
      setPhase("error");
      setMessage((error as Error).message || "Erika could not start the conversation.");
      cleanup();
    }
  }, [architecture, preset, cleanup, handleNativeText]);

  const speak = useCallback(() => {
    if (phase !== "live" || turnBusy.current) return;
    turnBusy.current = true;
    repairCount.current = 0;
    nativeTurnUsageUsd.current = 0;
    turnSeq.current += 1;
    if (architecture === "native") {
      if (!connection.current?.beginTurn()) {
        turnBusy.current = false;
        return;
      }
    } else {
      const currentMic = mic.current;
      if (!currentMic) {
        turnBusy.current = false;
        return;
      }
      turnChunks.current = [];
      const recorder = new MediaRecorder(currentMic);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) turnChunks.current.push(event.data);
      };
      recorder.start(250);
      turnRecorder.current = recorder;
    }
    setTurnPhase("recording");
  }, [architecture, phase]);

  const done = useCallback(async () => {
    if (phase !== "live" || turnPhase !== "recording") return;
    setTurnPhase("processing");
    doneAt.current = performance.now();
    if (architecture === "native") {
      const commitStarted = performance.now();
      if (!connection.current?.commitTurn()) {
        failTurn("That turn could not be committed. Tap Speak to try again.");
      } else {
        nativeCaptureCommitMs.current = performance.now() - commitStarted;
      }
      return;
    }
    const commitStarted = performance.now();
    const blob = await stopRecorder(turnRecorder.current, turnChunks.current);
    turnRecorder.current = null;
    if (!blob?.size) {
      failTurn("Nothing was recorded in that turn. Tap Speak to try again.");
      return;
    }
    const captureCommitMs = performance.now() - commitStarted;
    const form = new FormData();
    form.append("tutorId", tutorId.current ?? "");
    form.append("seq", String(turnSeq.current));
    form.append("preset", preset);
    form.append("context", JSON.stringify(context.current));
    form.append("audio", blob, `turn-${turnSeq.current}.webm`);
    try {
      const response = await fetch("/api/tutor/turn", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) {
        failTurn(body?.error?.message ?? TURN_RECOVERY_MESSAGE);
        return;
      }
      const parsed: ParsedTutorTurn = {
        result: body.result,
        droppedErrors: body.droppedErrors ?? [],
      };
      await completeTurn({
        parsed,
        transcript: body.transcript,
        captureCommitMs,
        transcriptionMs: body.latency?.transcriptionMs,
        modelMs: body.latency?.modelMs,
        transcriptionUsd: body.costs?.transcriptionUsd,
        modelUsd: body.costs?.modelUsd,
      });
    } catch (error) {
      failTurn((error as Error).message || TURN_RECOVERY_MESSAGE);
    }
  }, [architecture, completeTurn, failTurn, phase, preset, turnPhase]);

  const stop = useCallback(async () => {
    if (phase !== "live") return;
    setPhase("ending");
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
    const elapsedSeconds = (Date.now() - startedAt.current) / 1000;
    const id = tutorId.current;
    const blob = await stopRecorder(fullRecorder.current, fullChunks.current);
    fullRecorder.current = null;
    const landed = await landConversationTake({
      blob,
      capturedAt: new Date(startedAt.current),
      toWav: toUploadableWav,
      upload: uploadAudio,
    });
    if (id) {
      const closed = await fetch(`/api/tutor/session/${id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          elapsedSeconds,
          ...(architecture === "native"
            ? { realtimeUsageCostUsd: nativeSessionUsageUsd.current }
            : {}),
        }),
      })
        .then((response) => response.json())
        .catch(() => null);
      setClosing(closingLine(closed?.metMinimum === true, landed));
      setCost(costLine(closed?.committedUsd));
    }
    cleanup();
    tutorId.current = null;
    setPhase("idle");
    refresh();
  }, [architecture, cleanup, phase, refresh]);

  stopRef.current = stop;

  useEffect(() => {
    const onHide = () => {
      const id = tutorId.current;
      if (!id || phase !== "live") return;
      navigator.sendBeacon?.(
        `/api/tutor/session/${id}/end`,
        new Blob(
          [
            JSON.stringify({
              elapsedSeconds: (Date.now() - startedAt.current) / 1000,
              ...(architecture === "native"
                ? { realtimeUsageCostUsd: nativeSessionUsageUsd.current }
                : {}),
            }),
          ],
          { type: "application/json" },
        ),
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [architecture, phase]);

  return {
    info,
    phase,
    turnPhase,
    architecture,
    preset,
    elapsedMs,
    message,
    notice,
    closing,
    cost,
    lastTurn,
    setArchitecture,
    setPreset,
    start,
    speak,
    done,
    stop,
  };
}
