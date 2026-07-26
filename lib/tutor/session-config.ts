import type { Db } from "../db";
import { readSettings } from "../settings";
import { coerceRegister } from "../register";
import { collectSpeakerProfile, renderProfileLines } from "../analysis/profile";
import { listSlips } from "../slips";
import { compose } from "../compose";
import { parseItemId } from "../knowledge/items";
import { localDay } from "../local-day";
import { REALTIME_FLAGSHIP, type RealtimeModelId } from "../analysis/rates";
import { maxTutorSessionSeconds } from "./money";
import { TUTOR_EVIDENCE_MODES } from "./log-evidence";
import { buildTutorPrompt, tutorPromptHash } from "./prompt-presets";
import type { TutorArchitecture, TutorPromptPreset } from "./experiment";
import type { TutorPersonaInput } from "./persona";

// The tutor prompt/session config builder (E-34/E-48). Server-only DB glue: it collects the
// learner context through the CANONICAL readers only — `collectSpeakerProfile`
// (E-19), `listSlips` (E-20), `compose` (E-31) — builds the persona
// (lib/tutor/persona.ts), and assembles either architecture's exact selected prompt.
// No model call is made here (composition is model-free, E-31); no key is read here.

/** A concrete conversation target the persona names AND the model may log on — a
 *  validated knowledge-item id (lemma/rule) with a short human label. */
export interface TutorTarget {
  itemId: string;
  label: string;
}

/** E-48 disables provider VAD: only Speak → Done opens and commits one learner turn. */
export const TUTOR_TURN_DETECTION = null;

/**
 * The OpenAI Realtime session object (the mint body + the browser's session.update).
 *
 * E-48 restores D-28's native audio-in/text-out split and makes turn detection manual.
 * The selected voice belongs only to the common TTS route, so no output voice appears
 * here. Evidence is carried inside the shared structured result and validated by the
 * existing server route rather than emitted as a Realtime function call.
 */
export interface RealtimeSessionConfig {
  type: "realtime";
  model: RealtimeModelId;
  instructions: string;
  output_modalities: ["text"];
  audio: {
    input: { turn_detection: typeof TUTOR_TURN_DETECTION };
  };
  tools: RealtimeTool[];
  tool_choice: "auto";
  /** [T2b — money] The server-chosen ceiling on this session's length, in seconds — an
   *  independent second guard alongside the spend cap, bounding a call's LENGTH rather
   *  than its cost.
   *
   *  Enforced server-side by the heartbeat route,
   *  `app/api/tutor/session/[id]/heartbeat/route.ts`: once the SERVER-tracked elapsed
   *  time passes it, the heartbeat refuses to extend the lease (402, `covered: false`)
   *  and the client winds the call down. It is a REFUSAL, not a kill — a client that
   *  ignores it keeps billing, bounded from there by the hard spend cap.
   *
   *  Deliberately NEVER sent to OpenAI: the Realtime session schema has no such
   *  parameter, and posting it as an unknown param 400s the mint (OBS-001). The mint
   *  body is built from the explicit allowlist in lib/tutor/mint.ts, which omits it. */
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
 * Build the full native-listener session config: profile (E-19), active slips (E-20),
 * today's targets (E-31), register (E-33/D-23), selected prompt, and manual text-out
 * transport. Pure read + composition — no key, no model call.
 */
export function buildTutorPromptContext(db: Db, day: string = localDay()): {
  persona: TutorPersonaInput;
  targets: TutorTarget[];
} {
  const settings = readSettings(db);
  const profile = collectSpeakerProfile(db);
  const slipTargets = collectActiveSlipTargets(db);
  const targets = collectTutorTargets(db, day);
  return {
    persona: {
      register: coerceRegister(settings.register),
      targetLanguage: settings.targetLanguage,
      nativeLanguage: settings.nativeLanguage,
      profileLines: renderProfileLines(profile),
      slipTargets,
      todayTargets: targets.map((target) => `${target.label} — log as ${target.itemId}`),
    },
    targets,
  };
}

export function buildSelectedTutorPrompt(
  db: Db,
  architecture: TutorArchitecture,
  preset: TutorPromptPreset,
  day: string = localDay(),
): { prompt: string; promptHash: string; targets: TutorTarget[] } {
  const { persona, targets } = buildTutorPromptContext(db, day);
  const prompt = buildTutorPrompt({ architecture, preset, persona });
  return { prompt, promptHash: tutorPromptHash(prompt), targets };
}

export function buildTutorSessionConfig(
  db: Db,
  day: string = localDay(),
  preset: TutorPromptPreset = "current",
): {
  config: RealtimeSessionConfig;
  targets: TutorTarget[];
  promptHash: string;
} {
  const { prompt, promptHash, targets } = buildSelectedTutorPrompt(db, "native", preset, day);

  return {
    config: {
      type: "realtime",
      model: REALTIME_FLAGSHIP,
      instructions: prompt,
      output_modalities: ["text"],
      audio: {
        input: { turn_detection: TUTOR_TURN_DETECTION },
      },
      tools: [],
      tool_choice: "auto",
      maxSessionSeconds: maxTutorSessionSeconds(),
    },
    targets,
    promptHash,
  };
}

export type { RealtimeModelId } from "../analysis/rates";
