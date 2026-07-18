// What a polling hook should do with an HTTP status (E-16b criterion 6).
//
// `lib/use-ingest.ts` and `lib/use-analysis.ts` both treated every non-OK response
// as transient and scheduled another fetch a second later — forever. Delete a
// session while its detail page is open (or leave a tab on a stale URL) and the
// browser hammered a 404 route once a second for as long as the tab lived. A
// deleted session is not a transient failure: it is an answer, and it is final.

/** `use` — render this body; `retry` — try again later; `stop` — it is gone. */
export type PollAction = "use" | "retry" | "stop";

/**
 * 404 (never existed / no longer does) and 410 (explicitly gone) are terminal.
 * Everything else non-OK — a 500, a proxy hiccup, an offline moment — is treated
 * as transient, because those genuinely do recover and the run is still real.
 */
export function pollAction(status: number): PollAction {
  if (status >= 200 && status < 300) return "use";
  if (status === 404 || status === 410) return "stop";
  return "retry";
}
