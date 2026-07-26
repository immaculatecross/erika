"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { DotsField } from "@/components/tutor/dots-field";
import { ConversationProgress } from "@/components/tutor/conversation-progress";
import { ExperimentPanel } from "@/components/tutor/experiment-panel";
import { TurnDetails } from "@/components/tutor/turn-details";
import { NoticeLine } from "@/components/session/step-notice";
import { TRANSCRIPT_LIMITATION } from "@/lib/tutor/experiment";
import { useTutorLab } from "@/lib/tutor/use-tutor-lab";

export default function TutorPage() {
  const tutor = useTutorLab();
  const live = tutor.phase === "live" || tutor.phase === "ending";
  const primaryLabel =
    tutor.turnPhase === "recording"
      ? "Done"
      : tutor.turnPhase === "processing"
        ? "Listening…"
        : "Speak";
  const turnLine =
    tutor.turnPhase === "recording"
      ? "Speak for as long as you need. Pauses stay inside this turn."
      : tutor.turnPhase === "processing"
        ? "Erika is reading this turn."
        : "Your turn when you are ready.";

  return (
    <div data-tutor className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <Link
          href="/practice"
          className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Today
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[34px] font-bold tracking-tight">Conversation</h1>
        <p className="mt-1 text-[17px] text-secondary">
          Mark each turn yourself, then hear one short reply. The full conversation
          still becomes a normal recording and findings after you end it.
        </p>
      </header>

      <section className="flex flex-col items-center gap-6 rounded-card bg-card p-8 shadow-card">
        <DotsField
          active={live}
          intensity={tutor.turnPhase === "processing" ? 0.9 : tutor.turnPhase === "recording" ? 0.65 : 0.35}
        />

        {!live && (
          <ExperimentPanel
            architecture={tutor.architecture}
            preset={tutor.preset}
            disabled={tutor.phase === "connecting"}
            onArchitecture={tutor.setArchitecture}
            onPreset={tutor.setPreset}
          />
        )}

        {live ? (
          <>
            <ConversationProgress
              elapsedMs={tutor.elapsedMs}
              minSeconds={tutor.info?.minSeconds ?? 0}
            />
            <p
              className="max-w-sm text-center text-[13px] text-secondary"
              data-tutor-turn
              aria-live="polite"
            >
              {turnLine}
            </p>
            {tutor.architecture === "transcript" && (
              <p className="max-w-md text-center text-[13px] leading-relaxed text-secondary">
                {TRANSCRIPT_LIMITATION}
              </p>
            )}
            <motion.button
              type="button"
              onClick={() =>
                tutor.turnPhase === "recording"
                  ? void tutor.done()
                  : tutor.turnPhase === "ready"
                    ? tutor.speak()
                    : undefined
              }
              disabled={tutor.turnPhase === "processing" || tutor.phase === "ending"}
              className="rounded-full bg-accent px-8 py-3 text-[15px] font-medium text-accent-ink transition-transform focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 active:scale-[0.98] disabled:opacity-50"
              data-tutor-primary
            >
              {primaryLabel}
            </motion.button>
            <button
              type="button"
              onClick={() => void tutor.stop()}
              disabled={tutor.phase === "ending" || tutor.turnPhase !== "ready"}
              className="rounded-full px-5 py-2 text-[15px] font-medium text-secondary transition-colors hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 active:scale-[0.98] disabled:opacity-40"
              data-tutor-end
            >
              {tutor.phase === "ending" ? "Wrapping up…" : "End conversation"}
            </button>
          </>
        ) : tutor.info ? (
          <>
            <p className="tabular text-center text-[15px] text-secondary" data-tutor-ready>
              {tutor.info.minSeconds > 0
                ? `${Math.round(tutor.info.minSeconds / 60)} minutes of conversation counts toward your day.`
                : "A spoken conversation, steered toward your own recurring mistakes."}
            </p>
            <motion.button
              type="button"
              onClick={() => void tutor.start()}
              disabled={tutor.phase === "connecting"}
              className="rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-accent-ink transition-transform focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 active:scale-[0.98] disabled:opacity-50"
            >
              {tutor.phase === "connecting" ? "Connecting…" : "Start conversation"}
            </motion.button>
          </>
        ) : (
          <p className="text-[15px] text-secondary">Preparing…</p>
        )}

        <TurnDetails turn={tutor.lastTurn} />

        {tutor.closing && !live && (
          <p className="max-w-sm text-center text-[13px] text-secondary" role="status">
            {tutor.closing}
          </p>
        )}
        {tutor.cost && !live && (
          <p className="tabular max-w-sm text-center text-[13px] text-secondary">
            {tutor.cost}
          </p>
        )}
        {tutor.message && (
          <p
            className="max-w-sm text-center text-[13px] text-secondary"
            role="status"
            data-tutor-message
          >
            {tutor.message}
          </p>
        )}
        {tutor.notice && !live && (
          <NoticeLine
            reason={tutor.notice}
            onRetry={() => void tutor.start()}
            testId="tutor"
          />
        )}
      </section>
    </div>
  );
}
