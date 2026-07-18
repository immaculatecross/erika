import type { SlipState } from "@/lib/slips";

// The one badge a slip's state wears. D-14 / DESIGN: green (`good`) is reserved
// for mastery, so it attaches ONLY to resolved and remission (a slip going quiet
// is improving) — an active slip is a mistake still being made and reads neutral,
// never red (it is not a severity). Shared by the index and the dossier so they
// can never disagree, and pure/SSR-safe (asserted in green-reserved-style tests).

const STYLES: Record<SlipState, { label: string; text: string; tint: string }> = {
  resolved: { label: "Resolved", text: "text-good", tint: "bg-good/[0.12]" },
  remission: { label: "In remission", text: "text-good", tint: "bg-good/[0.12]" },
  active: { label: "Active", text: "text-secondary", tint: "bg-black/[0.06] dark:bg-white/[0.08]" },
};

export function SlipStateBadge({ state }: { state: SlipState }) {
  const s = STYLES[state];
  return (
    <span
      data-slip-state-badge={state}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${s.tint} ${s.text}`}
    >
      {s.label}
    </span>
  );
}
