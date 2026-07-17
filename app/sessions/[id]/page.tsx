"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { JobStateBadge } from "@/components/job-state-badge";
import { IngestStatus } from "@/components/ingest-status";
import { useIngest } from "@/lib/use-ingest";
import type { TimelineSegment } from "@/lib/ingest-view";
import { formatBytes, formatCreatedAt, formatDuration } from "@/lib/format";
import type { Session } from "@/lib/session-types";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; session: Session };

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
        {label}
      </span>
      <span className="tabular text-[17px] text-ink">{value}</span>
    </div>
  );
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [deleting, setDeleting] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // The ingest view polls itself (queued/processing → done/failed) without a
  // reload; the badge tracks its live state, falling back to the loaded session.
  const { view, polling, pollCount } = useIngest(id);

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((session: Session) => setState({ kind: "ready", session }))
      .catch(() => setState({ kind: "missing" }));
  }, [id]);

  function seekTo(segment: TimelineSegment) {
    setSelectedIdx(segment.idx);
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = segment.startMs / 1000;
    void audio.play().catch(() => {}); // autoplay may be blocked — the seek still lands
  }

  async function remove() {
    setDeleting(true);
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    } else {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-[15px] text-secondary hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Sessions
      </Link>

      {state.kind === "loading" && <p className="text-[15px] text-secondary">Loading session…</p>}
      {state.kind === "missing" && (
        <p className="text-[17px] text-secondary">This session no longer exists.</p>
      )}

      {state.kind === "ready" && (
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="min-w-0 break-words text-[34px] font-bold tracking-tight">
              {state.session.originalFilename}
            </h1>
            <JobStateBadge state={view?.state ?? state.session.jobState} />
          </div>

          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={`/api/sessions/${id}/audio`}
            className="w-full"
            aria-label="Session audio"
          />

          <div className="grid grid-cols-2 gap-5 rounded-card bg-card p-6 shadow-card sm:grid-cols-4">
            <Meta label="Duration" value={formatDuration(state.session.durationSeconds)} />
            <Meta label="Size" value={formatBytes(state.session.sizeBytes)} />
            <Meta label="Format" value={state.session.format.toUpperCase()} />
            <Meta label="Captured" value={formatCreatedAt(state.session.createdAt)} />
          </div>

          <div className="rounded-card bg-card p-6 shadow-card">
            <IngestStatus
              view={view}
              polling={polling}
              pollCount={pollCount}
              selectedIdx={selectedIdx}
              onSelect={seekTo}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="rounded-full px-5 py-2.5 text-[15px] font-medium text-severe transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete session"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
