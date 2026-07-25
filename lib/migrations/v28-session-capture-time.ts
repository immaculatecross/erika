import type { Migration } from "./index";

// E-39 §B2 / RETRO-004 Tier 1 §4 — `sessions.created_at` is the UPLOAD instant, and the
// app was reading it as the moment the learner spoke.
//
// `created_at` is a bare `DEFAULT (datetime('now'))` that `createSession` never overrides
// (lib/sessions.ts), so it records when the bytes finished landing. Meanwhile E-38's
// today-thread, Focus's "when you slip" histogram, the letter's week and the session
// page's literal "Captured" label all read it as capture time. The headline case is the
// one the product is designed around: record at 08:10, upload at 21:30, and Erika asserts
// "you used it in THIS EVENING's recording" — and an evening upload of the morning's
// speech lands on the wrong local day entirely. E-38's fix was right; the field it
// trusted was not.
//
// `sessions.captured_at` — when the learner actually spoke, in the same SQLite UTC text
//   format as every other timestamp in the schema, and **NULLABLE ON PURPOSE**. NULL
//   means "we do not know", which is a real and common answer: a plain mp3 with no
//   container metadata, dropped in from a file picker, genuinely carries no capture time
//   anywhere. The app's stance on an unknown fact is already settled everywhere else —
//   it does not make the claim — so NULL is the value that lets a surface refuse to
//   guess rather than quietly substitute the upload instant. `lib/capture-time.ts` is the
//   one place that decides what each kind of consumer does with NULL.
//
//   Deliberately NOT backfilled. Every existing row's capture time is unknown, and
//   `UPDATE sessions SET captured_at = created_at` would write the exact falsehood this
//   migration exists to remove — permanently, and indistinguishably from a real
//   measurement. An old session therefore keeps its honest NULL: it still appears
//   everywhere, filed under its upload instant and labelled "Uploaded", and it simply
//   makes no claim about the hour of day. `sessions` has one prior ALTER (v23), so this
//   follows the same additive pattern; no shipped migration is edited.
export const sessionCaptureTimeMigration: Migration = {
  version: 28,
  name: "session_capture_time",
  up: (db) => {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN captured_at TEXT;
      CREATE INDEX idx_sessions_captured ON sessions(captured_at);
    `);
  },
};
