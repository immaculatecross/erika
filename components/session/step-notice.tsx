"use client";

import Link from "next/link";
import { noticeFor, type NoticeReason } from "@/lib/session/notices";

// The one way the session says something could not run (E-44 criterion 3).
//
// Three rules, all held by `lib/session/notices.ts` and its tests rather than by this
// component: a standing condition is never called "right now", a named remedy is a
// working link, and a retryable condition gets a control that re-runs the call that
// failed — not a page reload, which would lose the session's place.
//
// It is deliberately quiet: hairline card, secondary ink, no red, no icon, no alarm.
// Nothing has gone wrong with the learner.

/**
 * The same notice, inline — for the controls that sit in a line rather than own a step
 * (the listen/compare/ask buttons, the tutor's start control).
 *
 * [v0.7 close sweep] It is in THIS file, reading THIS table, on purpose. The gate found
 * every one of those surfaces had written its own "unavailable right now" beside its own
 * unlinked "raise it" and its own retry that could not help; a second component would
 * have been a second dialect. The rules are not restated here — they are the table's,
 * and `tests/session-notices.test.ts` holds them: the retry renders only when the notice
 * says retrying can change the outcome, and the link renders only where the notice
 * carries a route that resolves.
 */
export function NoticeLine({
  reason,
  onRetry,
  testId,
}: {
  reason: NoticeReason;
  onRetry?: () => void;
  /** A stable hook for the surface's own render tests. */
  testId?: string;
}) {
  const notice = noticeFor(reason);
  return (
    <span
      data-notice-line={testId ?? reason}
      data-notice-reason={reason}
      className="inline-flex flex-wrap items-center gap-2"
    >
      <span className="text-[13px] text-secondary">{notice.body}</span>
      {notice.retryable && onRetry && (
        <button
          type="button"
          data-notice-retry
          onClick={onRetry}
          className="text-[13px] font-medium text-ink underline underline-offset-2"
        >
          Try again
        </button>
      )}
      {notice.action && (
        <Link
          href={notice.action.href}
          data-notice-action={notice.action.href}
          className="text-[13px] font-medium text-ink underline underline-offset-2"
        >
          {notice.action.label}
        </Link>
      )}
    </span>
  );
}

export function StepNotice({
  reason,
  onRetry,
}: {
  reason: NoticeReason;
  onRetry?: () => void;
}) {
  const notice = noticeFor(reason);
  return (
    <div
      data-step-notice={reason}
      className="flex flex-col gap-3 rounded-card border border-hairline p-5"
    >
      <p className="text-[15px] leading-[1.47] text-secondary">{notice.body}</p>
      <div className="flex flex-wrap items-center gap-3">
        {notice.retryable && onRetry && (
          <button
            type="button"
            data-notice-retry
            onClick={onRetry}
            className="rounded-full bg-card px-4 py-2 text-[15px] font-medium text-ink shadow-card transition-transform active:scale-[0.98]"
          >
            Try again
          </button>
        )}
        {notice.action && (
          <Link
            href={notice.action.href}
            data-notice-action={notice.action.href}
            className="text-[15px] font-medium text-ink underline underline-offset-4"
          >
            {notice.action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
