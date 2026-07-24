import type { Db } from "../db";
import { readSettings } from "../settings";
import { coerceRegister } from "../register";
import { collectSpeakerProfile, renderProfileLines } from "../analysis/profile";
import { listSlips } from "../slips";
import { compose } from "../compose";
import { parseItemId } from "../knowledge/items";
import { localDay } from "../local-day";
import { realtimeModelForTier, type RealtimeModelId } from "../analysis/rates";
import { maxTutorSessionSeconds } from "./money";
import { buildTutorPersona } from "./persona";
import { TUTOR_EVIDENCE_MODES } from "./log-evidence";

// The Realtime session config builder (E-34). Server-only DB glue: it collects the
// learner context through the CANONICAL readers only — `collectSpeakerProfile`
// (E-19), `listSlips` (E-20), `compose` (E-31) — builds the persona
// (lib/tutor/persona.ts), and assembles the session object the ephemeral-mint route
// sends to OpenAI and the browser uses for the WebRTC session. No model call is made
// here (composition is model-free, E-31); no key is read here (the mint route holds
// the key). The `log_evidence` function tool is declared here so the model can call
// it during the call (WO criterion 3).

/** A concrete conversation target the persona names AND the model may log on — a
 *  validated knowledge-item id (lemma/rule) with a short human label. */
export interface TutorTarget {
  itemId: string;
  label: string;
}

/** The default realtime voice. Pinned to a real account voice at real-run (the live
 *  WebRTC call is operator-gated); a neutral, widely-available default until then. */
export const TUTOR_VOICE = "marin";

/** The OpenAI Realtime session object (the mint body + the browser's session.update).
 *  Shaped per the VALIDATED 2026-07-24 contract: `type:"realtime"`, a `gpt-realtime`
 *  model, free-text instructions, an output voice, and function tools. */
export interface RealtimeSessionConfig {
  type: "realtime";
  model: RealtimeModelId;
  instructions: string;
  audio: { output: { voice: string } };
  tools: RealtimeTool[];
  tool_choice: "auto";
  /** [T2b — money] The server-chosen HARD ceiling on this session's length, in
   *  seconds. A bound the client cannot lengthen, so a long call cannot run unbounded
   *  (an independent second guard alongside the per-heartbeat cap). Mapped to the
   *  Realtime session-limit field at the operator-gated real-run (like `TUTOR_VOICE`). */
  maxSessionSeconds: number;
}

/** A Realtime function-tool declaration (the `log_evidence` tool). */
export interface RealtimeTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The `log_evidence` function tool the model calls during the conversation (WO
 *  criterion 3). Its args are validated server-side by `parseLogEvidenceArgs` before
 *  reaching the append-only door — this schema only shapes what the model sends. */
export function logEvidenceTool(): RealtimeTool {
  return {
    type: "function",
    name: "log_evidence",
    description:
      "Record one thing the learner just produced — an error OR a success — as structured evidence. " +
      "Call it whenever the learner uses one of the target grammar rules or vocabulary items, correctly or not.",
    parameters: {
      type: "object",
      properties: {
        itemId: {
          type: "string",
          description:
            "The exact target id this is evidence for: a grammar rule id (rule:<key>) or a lemma id (lemma:<lemma>#<POS>). Use only the ids named in your instructions.",
        },
        polarity: {
          type: "string",
          enum: ["correct", "incorrect"],
          description: "Whether the learner produced the target correctly.",
        },
        mode: {
          type: "string",
          enum: [...TUTOR_EVIDENCE_MODES],
          description: "spontaneous when the learner produced it unprompted; cued when you prompted them for it.",
        },
      },
      required: ["itemId", "polarity", "mode"],
      additionalProperties: false,
    },
  };
}

/** A short human label for a knowledge-item id (for the persona's target list). */
function labelForItem(itemId: string): string {
  const p = parseItemId(itemId);
  if (p.kind === "lemma" && p.lemma) return p.pos ? `${p.lemma} (${p.pos.toLowerCase()})` : p.lemma;
  if (p.kind === "rule") return itemId.slice("rule:".length).replace(/-/g, " ");
  return itemId;
}

/** At most this many of today's items are named in the persona (bounded prompt). */
export const TUTOR_MAX_TARGETS = 8;

/**
 * Collect today's evidence-bearing targets from the composed plan (E-31): every
 * plan item carrying a knowledge-item id (new vocab/rules and linked reviews),
 * deduped, bounded. These are the ONLY ids the persona tells the model to log on, so
 * a `log_evidence` call always names a real, validated id.
 */
export function collectTutorTargets(db: Db, day: string = localDay()): TutorTarget[] {
  const plan = compose(db, day);
  const seen = new Set<string>();
  const targets: TutorTarget[] = [];
  for (const item of plan.items) {
    if (!item.itemId || seen.has(item.itemId)) continue;
    const kind = parseItemId(item.itemId).kind;
    if (kind !== "lemma" && kind !== "rule") continue;
    seen.add(item.itemId);
    targets.push({ itemId: item.itemId, label: labelForItem(item.itemId) });
    if (targets.length >= TUTOR_MAX_TARGETS) break;
  }
  return targets;
}

/** At most this many active slips steer the conversation (bounded prompt). */
export const TUTOR_MAX_SLIPS = 5;

/** Active-slip correction phrases to steer toward (E-20), bounded. */
export function collectActiveSlipTargets(db: Db): string[] {
  return listSlips(db)
    .filter((s) => s.standing.state === "active")
    .slice(0, TUTOR_MAX_SLIPS)
    .map((s) => s.correction);
}

/**
 * Build the full Realtime session config for a tutor call: the tier's model, the
 * persona built from the profile (E-19) + active slips (E-20) + today's targets
 * (E-31) + the register dial (E-33/D-23), the output voice, and the `log_evidence`
 * tool. Pure read + composition — no key, no model call.
 */
export function buildTutorSessionConfig(db: Db, day: string = localDay()): {
  config: RealtimeSessionConfig;
  targets: TutorTarget[];
} {
  const settings = readSettings(db);
  const model = realtimeModelForTier(settings.realtimeTier);
  const profile = collectSpeakerProfile(db);
  const slipTargets = collectActiveSlipTargets(db);
  const targets = collectTutorTargets(db, day);

  const instructions = buildTutorPersona({
    register: coerceRegister(settings.register),
    targetLanguage: settings.targetLanguage,
    nativeLanguage: settings.nativeLanguage,
    profileLines: renderProfileLines(profile),
    slipTargets,
    // Name each target with its exact id so a log_evidence call is always on a real id.
    todayTargets: targets.map((t) => `${t.label} — log as ${t.itemId}`),
  });

  return {
    config: {
      type: "realtime",
      model,
      instructions,
      audio: { output: { voice: TUTOR_VOICE } },
      tools: [logEvidenceTool()],
      tool_choice: "auto",
      maxSessionSeconds: maxTutorSessionSeconds(),
    },
    targets,
  };
}

export type { RealtimeModelId, RealtimeTier } from "../analysis/rates";
