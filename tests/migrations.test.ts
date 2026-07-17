import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@/lib/db";

const tmpFiles: string[] = [];

function tmpDbPath(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "erika-mig-")), "erika.db");
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

describe("migrations runner", () => {
  it("creates the schema and records applied versions", () => {
    const db = openDatabase(tmpDbPath());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("settings");
    expect(tables).toContain("_migrations");
    const versions = db
      .prepare("SELECT version FROM _migrations")
      .all()
      .map((r) => (r as { version: number }).version);
    expect(versions).toContain(1);
    db.close();
  });

  it("is idempotent — a second run applies nothing", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    // openDatabase already ran migrations once; run again explicitly.
    const secondRun = runMigrations(db);
    expect(secondRun).toEqual([]);
    const count = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    expect(count.n).toBe(1);
    db.close();

    // And a fresh connection to the same file applies nothing new either.
    const reopened = openDatabase(p);
    const applied = runMigrations(reopened);
    expect(applied).toEqual([]);
    reopened.close();
  });
});
