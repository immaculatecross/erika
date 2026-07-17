import type { Database } from "better-sqlite3";

// Ordered, append-only migrations. Each `up` is a pure DDL step; the runner in
// lib/db.ts applies pending versions in order and records them in _migrations.
// Never edit a shipped migration — add a new one. Reused by E-2…E-5.
export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "settings",
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];
