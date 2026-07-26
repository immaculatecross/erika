"use client";

import {
  ARCHITECTURE_OPTIONS,
  PRESET_OPTIONS,
  TRANSCRIPT_LIMITATION,
  type TutorArchitecture,
  type TutorPromptPreset,
} from "@/lib/tutor/experiment";
import type { TutorTurnError } from "@/lib/tutor/turn-result";

export interface TutorTurnDetails {
  architecture: TutorArchitecture;
  preset: TutorPromptPreset;
  promptHash: string;
  transcript?: string;
  errors: TutorTurnError[];
  droppedErrors: TutorTurnError[];
  reply: string;
  evidenceRejected: string[];
  latency: {
    captureCommitMs: number;
    transcriptionMs?: number;
    modelMs?: number;
    firstTtsAudioMs: number;
    totalMs: number;
  };
  costs: {
    realtimeUsd?: number;
    transcriptionUsd?: number;
    modelUsd?: number;
    ttsUsd: number;
    totalUsd: number;
    kind: "usage-derived" | "modelled";
  };
}

function milliseconds(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value).toLocaleString()} ms`;
}

export function TurnDetails({ turn }: { turn: TutorTurnDetails | null }) {
  if (!turn) return null;
  const architecture =
    ARCHITECTURE_OPTIONS.find((option) => option.id === turn.architecture)?.label ??
    turn.architecture;
  const preset =
    PRESET_OPTIONS.find((option) => option.id === turn.preset)?.label ?? turn.preset;
  return (
    <details
      className="w-full rounded-control bg-ink/[0.04] p-4 text-left dark:bg-white/[0.06]"
      data-tutor-turn-details
    >
      <summary className="cursor-pointer text-[15px] font-medium text-ink">
        Last turn · experiment details
      </summary>
      <div className="mt-4 space-y-4 text-[13px] leading-relaxed text-secondary">
        <p>
          <span className="font-medium text-ink">{architecture}</span>
          <br />
          {preset}
        </p>
        {turn.architecture === "transcript" && (
          <div className="space-y-2">
            <p>{TRANSCRIPT_LIMITATION}</p>
            <p>
              <span className="font-medium text-ink">Transcript, as heard by STT</span>
              <br />
              {turn.transcript || "No intelligible speech returned."}
            </p>
          </div>
        )}
        <div>
          <p className="font-medium text-ink">Detected errors</p>
          {turn.errors.length === 0 ? (
            <p>None.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {turn.errors.map((error, index) => (
                <li key={`${error.quote}-${index}`}>
                  “{error.quote}” → “{error.correction}” · {error.category} ·{" "}
                  {error.confidence}
                  <br />
                  {error.explanation}
                </li>
              ))}
            </ul>
          )}
          {turn.droppedErrors.length > 0 && (
            <p className="mt-2 text-severe">
              {turn.droppedErrors.length} pronunciation{" "}
              {turn.droppedErrors.length === 1 ? "claim was" : "claims were"} withheld
              because this path received only text.
            </p>
          )}
        </div>
        <p>
          <span className="font-medium text-ink">Spoken reply</span>
          <br />
          {turn.reply}
        </p>
        {turn.evidenceRejected.length > 0 && (
          <p>
            <span className="font-medium text-ink">Evidence withheld</span>
            <br />
            {turn.evidenceRejected.join(" · ")}
          </p>
        )}
        <div className="tabular grid grid-cols-2 gap-x-4 gap-y-1">
          <span>Capture commit</span>
          <span>{milliseconds(turn.latency.captureCommitMs)}</span>
          {turn.architecture === "transcript" && (
            <>
              <span>Transcription</span>
              <span>{milliseconds(turn.latency.transcriptionMs)}</span>
            </>
          )}
          <span>Model</span>
          <span>{milliseconds(turn.latency.modelMs)}</span>
          <span>First TTS audio</span>
          <span>{milliseconds(turn.latency.firstTtsAudioMs)}</span>
          <span>Total</span>
          <span>{milliseconds(turn.latency.totalMs)}</span>
        </div>
        <p className="tabular">
          Turn cost · ${turn.costs.totalUsd.toFixed(4)} · {turn.costs.kind}
        </p>
        <p className="break-all">Prompt SHA-256 · {turn.promptHash}</p>
      </div>
    </details>
  );
}
