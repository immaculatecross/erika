// Small display helpers shared by the Sessions list and detail page. Kept
// framework-free so they can be unit tested directly.

/** Seconds → "m:ss" (or "h:mm:ss" past an hour). For tabular-numeral display. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Bytes → a compact human size ("1.4 GB", "952 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * USD → a compact money label for the cost estimate and budget. Sub-dime amounts
 * keep three decimals ("$0.004") so a fractional-cent estimate stays truthful
 * rather than rounding to "$0.00"; a dime or more shows the usual two ("$1.20").
 * For tabular-numeral display.
 */
export function formatUsd(usd: number): string {
  const v = Math.max(0, usd);
  if (v > 0 && v < 0.1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * [P4 — DESIGN restraint] A billable ESTIMATE label. A pre-call estimate is shown
 * only when it rounds to at least a cent ("$0.02"); anything smaller shows "<1¢"
 * rather than a spuriously precise "$0.002" or a rounded-to-nothing "$0.00" — a
 * fraction of a cent reads as "effectively free" without a misleading figure. Callers
 * prefix "est. " themselves ("est. <1¢", "est. $0.02"). For tabular-numeral display.
 */
export function formatEstimate(usd: number): string {
  const v = Math.max(0, usd);
  if (v < 0.01 - 1e-9) return "<1¢";
  return `$${v.toFixed(2)}`;
}

/** SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") → a locale date-time string. */
export function formatCreatedAt(iso: string): string {
  const d = new Date(`${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
