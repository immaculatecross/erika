"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EmptyState } from "@/components/empty-state";
import { Recorder } from "@/components/recorder";
import { SessionRow } from "@/components/session-row";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { uploadAudio } from "@/lib/upload-audio";
import { SUPPORTED_FORMATS } from "@/lib/session-types";
import type { SessionListItem } from "@/lib/sessions-list-view";

const ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(",");

type Upload = { kind: "idle" } | { kind: "busy"; name: string } | { kind: "error"; message: string };

export default function SessionsPage() {
  const reduced = usePrefersReducedMotion();
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/sessions");
    setSessions(res.ok ? await res.json() : []);
  }
  useEffect(() => {
    void load();
  }, []);

  function pick() {
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUpload({ kind: "busy", name: file.name });
    const result = await uploadAudio(file.name, file);
    if (result.ok) {
      setUpload({ kind: "idle" });
      await load();
    } else {
      setUpload({ kind: "error", message: result.message });
    }
  }

  const busy = upload.kind === "busy";

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
            line="No sessions yet. Record a take or upload a day's audio to begin."
            action={busy ? `Uploading ${upload.name}…` : "Upload audio"}
            onAction={pick}
            disabled={busy}
            actionVariant="secondary"
            secondary={<Recorder onRecorded={load} disabled={busy} variant="primary" />}
          />
          {upload.kind === "error" && (
            <p className="pb-8 text-center text-[13px] text-severe" role="alert">
              {upload.message}
            </p>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-3xl p-8">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[34px] font-bold tracking-tight">Sessions</h1>
            <div className="flex flex-wrap items-center gap-3">
              {/* [polish] Record leads (primary/accent); Upload is the secondary action. */}
              <Recorder onRecorded={load} disabled={busy} variant="primary" />
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
          <motion.ul
            variants={staggerContainer(reduced)}
            initial="initial"
            animate="animate"
            className="flex flex-col gap-2"
          >
            {sessions.map((s) => (
              <motion.li key={s.id} variants={staggerItem(reduced)}>
                <SessionRow item={s} onStarted={() => void load()} />
              </motion.li>
            ))}
          </motion.ul>
        </div>
      )}
    </>
  );
}
