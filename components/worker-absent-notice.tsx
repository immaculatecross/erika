"use client";

import { WORKER_ABSENT_MESSAGE } from "@/lib/jobs/liveness";

// One shared line for both queues (E-16b criterion 2). An upload that sat
// `queued` forever, and an Analyze that queued a second job which also sat, were
// both the same fact the app never stated: the work is done by a separate
// process. Shown only once the job is demonstrably not moving (lib/jobs/liveness).
//
// Quiet, not alarming — this is a "you haven't started it" state, not a failure,
// so it uses secondary ink and DESIGN's inline-code treatment for the command
// rather than red. `role="status"` so it is announced without interrupting.

export function WorkerAbsentNotice() {
  const [before, command, after] = WORKER_ABSENT_MESSAGE.split("`");
  return (
    <p className="text-[13px] text-secondary" role="status" data-worker-absent>
      {before}
      <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-ink dark:bg-white/[0.08]">
        {command}
      </code>
      {after}
    </p>
  );
}
