import type { IngestState } from "@/lib/session-types";

// The ingest job's state as a quiet dot + caption. Semantic tokens only where a
// state carries meaning (DESIGN.md D-14): green resolved, red failed. Queued and
// processing are in-flight, not outcomes, so they stay neutral (secondary ink).
const STATE: Record<IngestState, { label: string; dot: string; text: string }> = {
  queued: { label: "Queued", dot: "bg-secondary", text: "text-secondary" },
  processing: { label: "Processing", dot: "bg-secondary", text: "text-secondary" },
  done: { label: "Ready", dot: "bg-good", text: "text-good" },
  failed: { label: "Failed", dot: "bg-severe", text: "text-severe" },
};

export function JobStateBadge({ state }: { state: IngestState }) {
  const s = STATE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-[0.06em] ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}
