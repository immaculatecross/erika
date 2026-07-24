"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useRef, useState, useEffect } from "react";
import { ArrowLeft, UserX } from "lucide-react";
import { JobStateBadge } from "@/components/job-state-badge";
import { IngestStatus } from "@/components/ingest-status";
import { AnalysisPanel } from "@/components/analysis-panel";
import { useIngest } from "@/lib/use-ingest";
import { useAnalysis } from "@/lib/use-analysis";
import type { TimelineSegment } from "@/lib/ingest-view";
import type { FindingView } from "@/lib/analysis-view";
import {
  mapFindingsToSegments,
  segmentIdxForMs,
  highlightedFindingIds as computeHighlighted,
} from "@/lib/session-map";
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
  const [excluded, setExcluded] = useState(false);
  const [excludeSaving, setExcludeSaving] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // A `?t=<ms>` deep link (from the Speech archive, E-11) asks the reused player to
  // open at that offset. Read once on mount and consumed when audio metadata is
  // ready, so a cross-page jump lands exactly like the in-page report's onJump.
  const seekTargetRef = useRef<number | null>(null);

  // The ingest view polls itself (queued/processing → done/failed) without a
  // reload; the badge tracks its live state, falling back to the loaded session.
  const { view, polling, pollCount } = useIngest(id);
  // The analysis poll is lifted here so the session map (E-22) can plot the same
  // findings the report below shows, and a single selection is shared between them.
  const analysis = useAnalysis(id);

  // The session map: findings plotted on the ingest timeline. Both live at page
  // level, so one selection drives the marker, its segment, and the report row.
  const segments = useMemo(() => view?.segments ?? [], [view]);
  const rawMs = view?.summary.rawMs ?? 0;
  const findings = useMemo(
    () => (analysis.view?.findings ?? []).map((f) => ({ id: f.id, startMs: f.startMs, severity: f.severity })),
    [analysis.view],
  );
  const markers = useMemo(() => mapFindingsToSegments(segments, findings, rawMs), [segments, findings, rawMs]);
  const highlighted = useMemo(
    () => computeHighlighted(markers, selectedFindingId, selectedIdx),
    [markers, selectedFindingId, selectedIdx],
  );

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((session: Session) => {
        setState({ kind: "ready", session });
        setExcluded(session.excludeFromEvidence);
      })
      .catch(() => setState({ kind: "missing" }));
  }, [id]);

  // The manual "this recording isn't me" toggle (E-36, D-22). Optimistic and calm
  // (D-24): flip immediately, POST, and revert only if the write fails.
  async function toggleExcluded() {
    const next = !excluded;
    setExcluded(next);
    setExcludeSaving(true);
    try {
      const res = await fetch(`/api/sessions/${id}/exclude`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excluded: next }),
      });
      if (!res.ok) setExcluded(!next);
    } catch {
      setExcluded(!next);
    } finally {
      setExcludeSaving(false);
    }
  }

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    const ms = t === null ? NaN : Number(t);
    if (Number.isFinite(ms) && ms >= 0) seekTargetRef.current = ms;
  }, []);

  // Consume the deep-link target the moment the reused player can seek.
  function seekToDeepLink() {
    const ms = seekTargetRef.current;
    if (ms === null) return;
    seekTargetRef.current = null;
    seekToMs(ms);
  }

  // Seek the reused player to an absolute offset (ms). Shared by the speech
  // timeline and the analysis report's jump-to-audio so both land the same way.
  function seekToMs(startMs: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = startMs / 1000;
    void audio.play().catch(() => {}); // autoplay may be blocked — the seek still lands
  }

  function seekTo(segment: TimelineSegment) {
    setSelectedIdx(segment.idx);
    setSelectedFindingId(null); // a segment highlights every finding on it (vice-versa)
    seekToMs(segment.startMs);
  }

  // A finding selected from the report: highlight its segment on the map, no seek —
  // the report has its own "Play in context" control.
  function selectFinding(finding: FindingView) {
    setSelectedFindingId(finding.id);
    setSelectedIdx(segmentIdxForMs(segments, finding.startMs));
  }

  // A marker clicked on the map: select the finding, highlight its segment, and
  // play its moment — the map's own jump-to-audio (reusing the shared seek).
  function playFindingMarker(findingId: string) {
    const f = analysis.view?.findings.find((x) => x.id === findingId);
    if (!f) return;
    setSelectedFindingId(f.id);
    setSelectedIdx(segmentIdxForMs(segments, f.startMs));
    seekToMs(f.startMs);
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
            onLoadedMetadata={seekToDeepLink}
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
              findings={findings}
              highlightedFindingIds={highlighted}
              onSelectFinding={playFindingMarker}
            />
          </div>

          <div className="rounded-card bg-card p-6 shadow-card">
            <AnalysisPanel
              sessionId={id}
              analysis={analysis}
              onJump={seekToMs}
              highlightedFindingIds={highlighted}
              selectedFindingId={selectedFindingId}
              onSelectFinding={selectFinding}
            />
          </div>

          <div className="flex items-start gap-4 rounded-card bg-card p-6 shadow-card">
            <UserX size={22} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink">This recording isn&rsquo;t me</p>
              <p className="mt-0.5 text-[13px] text-secondary">
                Erika won&rsquo;t learn your vocabulary from a recording you exclude — useful when
                it&rsquo;s someone else speaking.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={excluded}
              aria-label="Exclude this recording from learning"
              onClick={toggleExcluded}
              disabled={excludeSaving}
              className={`relative mt-0.5 h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                excluded ? "bg-ink" : "bg-hairline"
              }`}
            >
              <span
                className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-card shadow-sm transition-transform ${
                  excluded ? "translate-x-[22px]" : "translate-x-[2px]"
                }`}
              />
            </button>
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
