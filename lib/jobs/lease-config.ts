// The lease's shared constants, split out from ./lease.ts so that client-safe
// modules can read them. ./lease.ts imports node:crypto for the worker identity,
// which the Next bundler refuses to follow into a client component — and the
// liveness verdict the session page renders needs this threshold. Re-exported by
// ./lease.ts, so every existing import site is unchanged.

/**
 * How long a job may go without a heartbeat before another worker may take it.
 *
 * Sized comfortably above the slowest single checkpoint. That is the ingest
 * `normalizing` stage: one ffmpeg pass over a 24 h day-scale dump (D-9), which
 * runs uninterrupted and cannot beat inside itself. Every other step — per
 * segment extract/render, per segment triage/deep-listen — beats far more often.
 * Too short and a live job gets stolen (the bug); too long only delays recovery
 * from a real crash, so this errs long deliberately.
 */
export const JOB_LEASE_STALE_MS = 15 * 60 * 1000;

/** The two lease-bearing job tables. Interpolated into SQL — never user input. */
export type JobTable = "ingest_jobs" | "analysis_jobs";
