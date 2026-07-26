import type { Db } from "./db";
import { REGISTERS, DEFAULT_REGISTER, isRegister, type Register } from "./register";
import { DEFAULT_TUTOR_VOICE, isRealtimeVoice, REALTIME_VOICES, type RealtimeVoice } from "./tutor/voices";
import {
  DEFAULT_REALTIME_TIER,
  isRealtimeTier,
  REALTIME_TIERS,
  type RealtimeTier,
} from "./analysis/rates-realtime";

// The persisted preferences. [RETRO-002 P5] The vestigial `modelTier` (no behavior
// ever hung off it) was removed at E-34.
//
// [E-43] `realtimeTier` (flagship / mini) IS REMOVED TOO, and its removal is the
// reason this milestone can afford a voice dial at all (D-26: the count goes down).
// It offered a model spike-6 §3.1 measured as unfit for the tutor's core job — 3
// empty replies and 2 hallucinated errors on clean speech out of 9 — so the choice
// was between "works" and "invents corrections", which is not a choice to put in
// front of a learner. The listening model is now a code default with an env override
// (`tutorRealtimeModel`).
//
// A database that stored `realtimeTier` still reads fine: `readSettings` selects the
// keys it knows and ignores the rest, so a removed key is inert, not fatal
// (tests/settings.test.ts pins this). The same holds for a `tutorVoice` holding the
// short-lived `female`/`male` values an earlier TTS revision carried: an unrecognized
// voice reads as the default rather than throwing (`coerceTutorVoice`).

export interface Settings {
  targetLanguage: string;
  nativeLanguage: string;
  monthlyBudgetUsd: number;
  // The daily composer's new-item caps (E-31, D-19): how many NEW items at the
  // knowledge edge enter each day's plan, per kind. Defaults 10 / 3 / 10 (WO).
  newVocabPerDay: number;
  newRulesPerDay: number;
  newPronPerDay: number;
  // The register dial (E-33, D-23): colloquiale → standard → colto → letterario,
  // default colto. Injected into analysis recasts, lesson generation, TTS voice
  // style, and the E-34 tutor persona (lib/register.ts). Style only, never
  // correctness.
  register: Register;
  // The tutor's voice (E-43, Amendment 5): one of the ten voices the Realtime API
  // accepts. The list and the default live in lib/tutor/voices.ts, never here.
  tutorVoice: RealtimeVoice;
  // Which Realtime tier the tutor runs on (E-34, deleted at E-43, restored by operator
  // ruling once the flagship price was visible: "worth putting that in the settings
  // that I can try"). Default flagship. spike-6 measured mini hallucinating
  // corrections, so the Settings copy says so in one sentence — see
  // lib/analysis/rates-realtime.ts. Both tiers are priced; neither is a guess.
  realtimeTier: RealtimeTier;
  // How long a tutor conversation must run to count toward the day (E-43 criterion
  // 6). Below it the conversation is still real and still logs evidence — it simply
  // has not met the bar. Shown as calm progress on the tutor surface; never a
  // countdown, and leaving early costs nothing and says nothing (D-24).
  tutorMinMinutes: number;
}

/** The three new-item-per-day caps that are user-settable — the composer's
 *  per-kind budget (its `dailyMax` ceiling is a composer constant, not a knob). */
export const NEW_ITEM_CAP_KEYS = ["newVocabPerDay", "newRulesPerDay", "newPronPerDay"] as const;

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "Italian",
  nativeLanguage: "English",
  // E-28 raises the default cap 25 → 50 to match the richness dial's posture
  // (D-20): short captures are now 100% deep-listened and day dumps triage
  // looser, so the app spends more for the richest picture of the user's speech.
  // A day dump ≈ $1.77 and a 10-min capture ≈ $0.22 (D-20), so $50/mo comfortably
  // covers roughly a dump a day plus short captures. Still user-editable in
  // Settings; the hard cap (E-27 reserve-before-call) makes the spend safe.
  monthlyBudgetUsd: 50,
  newVocabPerDay: 10,
  newRulesPerDay: 3,
  newPronPerDay: 10,
  register: DEFAULT_REGISTER,
  tutorVoice: DEFAULT_TUTOR_VOICE,
  realtimeTier: DEFAULT_REALTIME_TIER,
  // Ten minutes, by operator ruling after driving the built tutor ("let's make it ten
  // minutes default"; it was five). Still settable, still shown as progress, and still
  // with no countdown, no warning and no guilt copy for leaving early (D-24).
  tutorMinMinutes: 10,
};

/** Read every preference, filling any unset key from DEFAULT_SETTINGS. */
export function readSettings(db: Db): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const budget = stored.get("monthlyBudgetUsd");
  const capOr = (key: (typeof NEW_ITEM_CAP_KEYS)[number]): number => {
    const v = stored.get(key);
    return v !== undefined ? Number(v) : DEFAULT_SETTINGS[key];
  };
  return {
    targetLanguage: stored.get("targetLanguage") ?? DEFAULT_SETTINGS.targetLanguage,
    nativeLanguage: stored.get("nativeLanguage") ?? DEFAULT_SETTINGS.nativeLanguage,
    monthlyBudgetUsd: budget !== undefined ? Number(budget) : DEFAULT_SETTINGS.monthlyBudgetUsd,
    newVocabPerDay: capOr("newVocabPerDay"),
    newRulesPerDay: capOr("newRulesPerDay"),
    newPronPerDay: capOr("newPronPerDay"),
    register: isRegister(stored.get("register")) ? (stored.get("register") as Register) : DEFAULT_SETTINGS.register,
    tutorVoice: isRealtimeVoice(stored.get("tutorVoice"))
      ? (stored.get("tutorVoice") as RealtimeVoice)
      : DEFAULT_SETTINGS.tutorVoice,
    realtimeTier: isRealtimeTier(stored.get("realtimeTier"))
      ? (stored.get("realtimeTier") as RealtimeTier)
      : DEFAULT_SETTINGS.realtimeTier,
    tutorMinMinutes: minutesOr(stored.get("tutorMinMinutes")),
  };
}

/** A stored minimum-duration value, or the default when unset or unusable. */
function minutesOr(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SETTINGS.tutorMinMinutes;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.tutorMinMinutes;
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

  if (patch.tutorVoice !== undefined) {
    if (!isRealtimeVoice(patch.tutorVoice)) {
      throw new SettingsValidationError(`tutorVoice must be one of: ${REALTIME_VOICES.join(", ")}.`);
    }
    out.tutorVoice = patch.tutorVoice;
  }

  if (patch.realtimeTier !== undefined) {
    if (!isRealtimeTier(patch.realtimeTier)) {
      throw new SettingsValidationError(`realtimeTier must be one of: ${REALTIME_TIERS.join(", ")}.`);
    }
    out.realtimeTier = patch.realtimeTier;
  }

  if (patch.tutorMinMinutes !== undefined) {
    const raw = patch.tutorMinMinutes;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (typeof raw === "boolean" || raw === "" || raw === null || !Number.isFinite(n) || n < 0) {
      throw new SettingsValidationError("tutorMinMinutes must be a number of minutes, 0 or more.");
    }
    out.tutorMinMinutes = n;
  }

  if (patch.monthlyBudgetUsd !== undefined) {
    const raw = patch.monthlyBudgetUsd;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (typeof raw === "boolean" || raw === "" || raw === null || !Number.isFinite(n) || n < 0) {
      throw new SettingsValidationError("monthlyBudgetUsd must be a number of dollars, 0 or more.");
    }
    out.monthlyBudgetUsd = n;
  }

  for (const key of NEW_ITEM_CAP_KEYS) {
    if (patch[key] === undefined) continue;
    const raw = patch[key];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (typeof raw === "boolean" || raw === "" || raw === null || !Number.isInteger(n) || n < 0) {
      throw new SettingsValidationError(`${key} must be a whole number of items, 0 or more.`);
    }
    out[key] = n;
  }

  if (patch.register !== undefined) {
    if (!isRegister(patch.register)) {
      throw new SettingsValidationError(`register must be one of: ${REGISTERS.join(", ")}.`);
    }
    out.register = patch.register;
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
