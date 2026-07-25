"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { EmptyState } from "@/components/empty-state";
import { Recorder } from "@/components/recorder";
import { SessionRow } from "@/components/session-row";
import { WorkerAbsentNotice } from "@/components/worker-absent-notice";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { uploadAudio } from "@/lib/upload-audio";
import { useSessions } from "@/lib/use-sessions";
import { SUPPORTED_FORMATS } from "@/lib/session-types";
import { isInFlight, sessionPhase } from "@/lib/sessions-list-view";

const ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(",");

type Upload = { kind: "idle" } | { kind: "busy"; name: string } | { kind: "error"; message: string };

// The home: your recordings, and what Erika is doing with them.
//
// [E-42 criterion 4] IT FOLLOWS THE SESSION. This page used to `load()` on mount and
// once after an upload, and never again — so the only way to see that ingest had
// finished was to reload by hand. That was survivable while analysis needed a button
// press; with analysis automatic it would have meant the entire pipeline running to
// completion behind a screen frozen on "Not analyzed yet". `useSessions` follows the
// list until everything settles and then stops (lib/use-sessions.ts).
//
// [criterion 1] Choosing a file IS the confirmation: the picker opens, you choose,
// and upload → ingest → analysis run with nothing further to press. The mic path's
// one confirmation lives in <Recorder/>.
//
// [criterion 7] There is no money on this screen. Not an estimate, not a running
// total, not a budget. What analysis costs, that it happens automatically, and what
// the monthly cap does are stated once, in prose, in Settings — where a person can
// read them before any of it starts rather than as a number beside a button.

export default function SessionsPage() {
  const reduced = usePrefersReducedMotion();
  const { sessions, polling, pollCount, refresh } = useSessions();
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  function pick() {
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUpload({ kind: "busy", name: file.name });
    const result = await uploadAudio(file.name, file, {
      // A weaker capture hint than a mic take's start instant, and ranked below the
      // container's own embedded creation time — but far better than the upload
      // instant for the case this milestone exists to fix: a day dump recorded this
      // morning and dropped in tonight (E-42 criterion 5, lib/capture-time.ts).
      capturedAtHint: Number.isFinite(file.lastModified)
        ? new Date(file.lastModified).toISOString()
        : undefined,
    });
    if (result.ok) {
      setUpload({ kind: "idle" });
      refresh(); // pick the new session up and follow it
    } else {
      setUpload({ kind: "error", message: result.message });
    }
  }

  const busy = upload.kind === "busy";
  // One notice for the whole screen, not one per row: the work happens in a second
  // process, and a learner who has never started it needs the command once. This is
  // the single most common cold-start dead end this app has (RETRO-004 §DE-1).
  const workerAbsent = (sessions ?? []).some((s) => isInFlight(sessionPhase(s)) && s.workerAbsent);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onFile}
        className="hidden"
        aria-hidden
      />

      {sessions === null ? (
        <div className="p-8 text-[15px] text-secondary">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col">
          <EmptyState
            title="Sessions"
            line="Record a take or drop in a day's audio. Erika listens to it and finds your mistakes — you don't have to start anything."
            action={busy ? `Uploading ${upload.name}…` : "Upload audio"}
            onAction={pick}
            disabled={busy}
            actionVariant="secondary"
            secondary={<Recorder onRecorded={refresh} disabled={busy} variant="primary" />}
          />
          {upload.kind === "error" && (
            <p className="pb-8 text-center text-[13px] text-severe" role="alert">
              {upload.message}
            </p>
          )}
        </div>
      ) : (
        <div
          className="mx-auto max-w-3xl p-8"
          data-sessions
          data-polling={polling}
          data-poll-count={pollCount}
        >
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[34px] font-bold tracking-tight">Sessions</h1>
            <div className="flex flex-wrap items-center gap-3">
              {/* Record leads (primary/accent); Upload is the secondary action. */}
              <Recorder onRecorded={refresh} disabled={busy} variant="primary" />
              <button
                type="button"
                onClick={pick}
                disabled={busy}
                className="rounded-full bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
              >
                {busy ? `Uploading ${upload.name}…` : "Upload audio"}
              </button>
            </div>
          </header>
          {upload.kind === "error" && (
            <p className="mb-4 text-[13px] text-severe" role="alert">
              {upload.message}
            </p>
          )}
          {workerAbsent && (
            <div className="mb-4">
              <WorkerAbsentNotice />
            </div>
          )}
          <motion.ul
            variants={staggerContainer(reduced)}
            initial="initial"
            animate="animate"
            className="flex flex-col gap-2"
          >
            {sessions.map((s) => (
              <motion.li key={s.id} variants={staggerItem(reduced)}>
                <SessionRow item={s} />
              </motion.li>
            ))}
          </motion.ul>
        </div>
      )}
    </>
  );
}
