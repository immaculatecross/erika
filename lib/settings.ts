import type { Db } from "./db";

// The four preferences E-1 persists. "modelTier" and "monthlyBudgetUsd" are
// stored fields only — no behavior hangs off them until E-4 (see WO scope).
export const MODEL_TIERS = ["mini", "standard", "deep"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export interface Settings {
  targetLanguage: string;
  nativeLanguage: string;
  modelTier: ModelTier;
  monthlyBudgetUsd: number;
}

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "Italian",
  nativeLanguage: "English",
  modelTier: "standard",
  // E-28 raises the default cap 25 → 50 to match the richness dial's posture
  // (D-20): short captures are now 100% deep-listened and day dumps triage
  // looser, so the app spends more for the richest picture of the user's speech.
  // A day dump ≈ $1.77 and a 10-min capture ≈ $0.22 (D-20), so $50/mo comfortably
  // covers roughly a dump a day plus short captures. Still user-editable in
  // Settings; the hard cap (E-27 reserve-before-call) makes the spend safe.
  monthlyBudgetUsd: 50,
};

/** Read all four preferences, filling any unset key from DEFAULT_SETTINGS. */
export function readSettings(db: Db): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const budget = stored.get("monthlyBudgetUsd");
  return {
    targetLanguage: stored.get("targetLanguage") ?? DEFAULT_SETTINGS.targetLanguage,
    nativeLanguage: stored.get("nativeLanguage") ?? DEFAULT_SETTINGS.nativeLanguage,
    modelTier: (stored.get("modelTier") as ModelTier) ?? DEFAULT_SETTINGS.modelTier,
    monthlyBudgetUsd: budget !== undefined ? Number(budget) : DEFAULT_SETTINGS.monthlyBudgetUsd,
  };
}

/** Thrown when a submitted value fails validation. Message is user-facing. */
export class SettingsValidationError extends Error {}

/**
 * Validate and coerce an untrusted patch into concrete values. Invalid budgets
 * are rejected with a truthful message, never silently coerced to a default.
 */
export function validateSettings(patch: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {};

  for (const key of ["targetLanguage", "nativeLanguage"] as const) {
    if (patch[key] === undefined) continue;
    const v = patch[key];
    if (typeof v !== "string" || v.trim() === "") {
      throw new SettingsValidationError(`${key} must be a non-empty language name.`);
    }
    out[key] = v.trim();
  }

  if (patch.modelTier !== undefined) {
    const v = patch.modelTier;
    if (typeof v !== "string" || !MODEL_TIERS.includes(v as ModelTier)) {
      throw new SettingsValidationError(`modelTier must be one of: ${MODEL_TIERS.join(", ")}.`);
    }
    out.modelTier = v as ModelTier;
  }

  if (patch.monthlyBudgetUsd !== undefined) {
    const raw = patch.monthlyBudgetUsd;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (typeof raw === "boolean" || raw === "" || raw === null || !Number.isFinite(n) || n < 0) {
      throw new SettingsValidationError("monthlyBudgetUsd must be a number of dollars, 0 or more.");
    }
    out.monthlyBudgetUsd = n;
  }

  return out;
}

/** Validate `patch`, upsert it, and return the full settings after the write. */
export function writeSettings(db: Db, patch: Record<string, unknown>): Settings {
  const clean = validateSettings(patch);
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(clean)) {
      upsert.run(key, String(value));
    }
  });
  tx();
  return readSettings(db);
}
