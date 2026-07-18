import type { Db } from "../db";
import { readSettings } from "../settings";
import { listIncludedFindings } from "../findings-model";
import { buildFocusModel, SEVERITY_WEIGHT, type FocusModel } from "../focus";
import { getMastery } from "../lessons/mastery";
import { patternKey } from "../lessons/patterns";
import { CATEGORIES, type Category, type Severity } from "./findings";

// The compact speaker profile (E-19): what the listening model knows about who
// it is listening to, built from data the app ALREADY has — settings, included
// findings, the Focus rates, lesson mastery. No model call is ever made to build
// it. `buildSpeakerProfile` + `renderProfileLines` are pure and unit-tested;
// `collectSpeakerProfile` is the thin DB glue that feeds them through the
// canonical readers (lib/findings-model.ts, computeFocus — no reimplemented
// math). The rendered block is HARD-BOUNDED in entries and characters, so the
// prompts never grow with the corpus.

/** At most this many recurring quote→correction entries are profiled. */
export const PROFILE_MAX_ENTRIES = 5;
/** Each quoted field is clipped to this many characters before rendering. */
export const PROFILE_FIELD_MAX_CHARS = 60;
/** Hard cap on the whole rendered profile block (all lines joined). */
export const PROFILE_MAX_CHARS = 1200;
/** A correction must recur this often to become a profile entry. */
export const PROFILE_RECURRENCE_MIN = 2;

/** One recurring quote→correction pair the deep model may mark as recurring. */
export interface ProfileEntry {
  /** Stable per-profile label ("R1"…) — what the deep reply echoes back. */
  id: string;
  quote: string;
  correction: string;
  category: Category;
  /** How many included findings share this correction. */
  count: number;
}

export interface CategoryRate {
  category: Category;
  count: number;
  /** findings ÷ analysed speech-hours, straight from computeFocus. */
  ratePerHour: number;
}

export interface SpeakerProfile {
  nativeLanguage: string;
  /** Top recurring pairs, severity-weighted, deduped by correction. */
  entries: ProfileEntry[];
  /** Non-zero per-category rates (computeFocus's numbers, never recomputed). */
  rates: CategoryRate[];
  /** Non-zero per-category lesson mastery (0..1). */
  mastery: { category: Category; mastery: number }[];
}

/** What the pure builder needs — collected from the db by `collectSpeakerProfile`. */
export interface ProfileInput {
  nativeLanguage: string;
  /** Included findings, newest first (`listIncludedFindings` order). */
  findings: readonly { quote: string; correction: string; category: Category; severity: Severity }[];
  /** The Focus model — the ONLY source of rates (no reimplemented math). */
  focus: FocusModel;
  /** Per-category lesson mastery, 0 when never practised. */
  mastery: readonly { category: Category; mastery: number }[];
}

/** Clip a field for prompt rendering; the cap is what bounds prompt growth. */
function clip(s: string, max = PROFILE_FIELD_MAX_CHARS): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Build the profile. Recurrence is deduped by normalized correction (the same
 * fix prescribed twice is one habit, however the quotes varied); groups are
 * ranked by summed severity weight (D-15's high>medium>low), then count, then
 * correction for a deterministic order; the representative quote/correction is
 * the newest occurrence. Everything is bounded: at most PROFILE_MAX_ENTRIES
 * entries, every field clipped. An empty input yields a well-formed minimal
 * profile — just the native language.
 */
export function buildSpeakerProfile(input: ProfileInput): SpeakerProfile {
  const groups = new Map<
    string,
    { quote: string; correction: string; category: Category; count: number; weight: number }
  >();
  for (const f of input.findings) {
    const key = f.correction.trim().toLowerCase();
    if (key === "") continue;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.weight += SEVERITY_WEIGHT[f.severity];
    } else {
      // Findings arrive newest first, so the first seen is the freshest phrasing.
      groups.set(key, {
        quote: f.quote,
        correction: f.correction,
        category: f.category,
        count: 1,
        weight: SEVERITY_WEIGHT[f.severity],
      });
    }
  }
  const entries = [...groups.values()]
    .filter((g) => g.count >= PROFILE_RECURRENCE_MIN)
    .sort(
      (a, b) =>
        b.weight - a.weight || b.count - a.count || (a.correction < b.correction ? -1 : 1),
    )
    .slice(0, PROFILE_MAX_ENTRIES)
    .map((g, i) => ({
      id: `R${i + 1}`,
      quote: clip(g.quote),
      correction: clip(g.correction),
      category: g.category,
      count: g.count,
    }));

  return {
    nativeLanguage: input.nativeLanguage,
    entries,
    rates: input.focus.categories
      .filter((c) => c.count > 0)
      .map((c) => ({ category: c.category, count: c.count, ratePerHour: c.ratePerHour })),
    mastery: input.mastery.filter((m) => m.mastery > 0),
  };
}

/** The one L1 sentence every model prompt carries (exact-tested). */
export function l1Line(nativeLanguage: string): string {
  return `The speaker's native language (L1) is ${nativeLanguage}.`;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Render the profile as prompt lines. Always starts with the L1 line; a fresh
 * user gets ONLY that line — no empty scaffolding, nothing undefined. The whole
 * block is hard-capped at PROFILE_MAX_CHARS by dropping trailing entry lines
 * (never the L1 line), so no corpus can grow the prompts unbounded.
 */
export function renderProfileLines(profile: SpeakerProfile): string[] {
  const lines: string[] = [l1Line(profile.nativeLanguage)];
  const entryLines = profile.entries.map(
    (e) => `${e.id}. said "${e.quote}" → "${e.correction}" (${e.category}, seen ${e.count}x)`,
  );
  if (entryLines.length > 0) {
    lines.push("Known recurring errors for this speaker (numbered):", ...entryLines);
  }
  if (profile.rates.length > 0) {
    lines.push(
      `Error rates per analysed hour: ${profile.rates
        .map((r) => `${r.category} ${round1(r.ratePerHour)}`)
        .join(", ")}.`,
    );
  }
  if (profile.mastery.length > 0) {
    lines.push(
      `Lesson mastery (0–1): ${profile.mastery
        .map((m) => `${m.category} ${round1(m.mastery)}`)
        .join(", ")}.`,
    );
  }
  // Hard character cap: shed entry lines from the end until the block fits.
  const total = (ls: string[]) => ls.join("\n").length;
  while (total(lines) > PROFILE_MAX_CHARS && lines.length > 1) {
    const lastEntry = lines.findLastIndex((l) => /^R\d+\. /.test(l));
    lines.splice(lastEntry === -1 ? lines.length - 1 : lastEntry, 1);
  }
  return lines;
}

/** The rendered block as one string, for prompt builders. */
export function profileBlock(profile: SpeakerProfile): string {
  return renderProfileLines(profile).join("\n");
}

/**
 * Resolve a deep reply's optional recurrence reference to what gets persisted:
 * the matched entry's correction text. Defensive by design (D-13): no profile,
 * no reference, or an unknown/garbage reference all resolve to null — never an
 * error, never a dropped finding.
 */
export function resolveRecurrence(
  profile: SpeakerProfile | undefined,
  recurrenceId: string | undefined,
): string | null {
  if (!profile || !recurrenceId) return null;
  const entry = profile.entries.find((e) => e.id === recurrenceId);
  return entry ? entry.correction : null;
}

/**
 * Build the profile from the database, through the canonical readers only:
 * settings for L1, `listIncludedFindings` for the pairs, `buildFocusModel`
 * (computeFocus) for the rates, `lesson_mastery` via the E-6 accessor. Read-only
 * and model-call-free — safe to run at the top of every analysis or lesson run.
 */
export function collectSpeakerProfile(db: Db): SpeakerProfile {
  const { nativeLanguage } = readSettings(db);
  return buildSpeakerProfile({
    nativeLanguage,
    findings: listIncludedFindings(db),
    focus: buildFocusModel(db),
    mastery: CATEGORIES.map((category) => ({ category, mastery: getMastery(db, patternKey(category)) })),
  });
}
