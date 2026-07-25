import type { Migration } from "./index";

// E-43 · v29 — the durable record of a spoken conversation.
//
// Until now a tutor call left nothing behind but ledger rows and, if the upload
// worked, an ordinary session. Nothing could answer "did a real conversation happen
// today, and did it last long enough to count" — which is exactly what WO-E44 needs
// to credit the day, and exactly why D-26 says the daily goal counting flashcards
// alone is the mechanical root of the "pile of optional errands" feeling.
//
// One row per conversation, written at open and closed at end.
//
//   id                 the tutor session id — the same id that keys the spend lease
//                      (`tutor:<id>`) and the heartbeat/end routes, so the money and
//                      the record are trivially joinable and cannot disagree on
//                      identity.
//   started_at         SQLite UTC text, server clock, written at open.
//   ended_at           NULL while the conversation is live or was abandoned.
//   duration_seconds   SERVER-MEASURED, NULL until closed. See the polarity note.
//   min_seconds        the minimum in force WHEN THIS CONVERSATION STARTED, copied in
//                      rather than read live, so changing the setting tomorrow never
//                      rewrites what already happened (the E-38 lesson: recorded
//                      history is never rewritten).
//   met_minimum        0/1, decided once at close and stored. Derived state would be
//                      re-derived against a moved goalpost.
//   session_id         the recording's session id when one landed, else NULL. FK with
//                      ON DELETE SET NULL: deleting a session must not delete the fact
//                      that the conversation happened.
//   local_day          the LOCAL calendar day the conversation closed on (D-24, E-31 —
//                      a streak day is a local day, never a UTC one). Stored, not
//                      derived, because the local timezone at read time need not be
//                      the one the learner lived in.
//
// ⚠️ THE TWO DURATION POLARITIES ARE OPPOSITE ON PURPOSE, and it looks like a bug
// until you name both. For MONEY, the server FLOORS the client
// (`max(client, server)`) so a client cannot under-report a long call to under-pay.
// For CREDIT, the client may only ever LOWER the server's figure
// (`min(server, client)`) — the server's elapsed includes connecting and idling,
// while the client knows how much of it was actually a conversation, and a learner
// under-crediting themselves harms nobody. Each direction is the conservative one for
// its own purpose. `lib/tutor/conversations.ts` states this at the call site too.
//
// Additive only; no shipped migration is edited.
export const tutorConversationsMigration: Migration = {
  version: 29,
  name: "tutor_conversations",
  up: (db) => {
    db.exec(`
      CREATE TABLE tutor_conversations (
        id               TEXT PRIMARY KEY,
        started_at       TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at         TEXT,
        duration_seconds REAL,
        min_seconds      INTEGER NOT NULL,
        met_minimum      INTEGER NOT NULL DEFAULT 0,
        session_id       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        local_day        TEXT
      );
      CREATE INDEX idx_tutor_conversations_day ON tutor_conversations(local_day);
      CREATE INDEX idx_tutor_conversations_session ON tutor_conversations(session_id);
    `);
  },
};
