import type { Db } from "../db";
import { REQUIRED_KEY, ENV_LOCAL } from "../analysis-key";
import { hasAnalysisKey } from "../env-file";
import { readSettings } from "../settings";
import { onboardingComplete } from "./state";

// What Erika needs, said once, before the learner discovers it the hard way
// (E-46 criterion 2). This is the answer to RETRO-004's headline finding: v0.6
// "failed cold start not because it is broken, but because it is inert" — the only
// place a new user learned that a key was required was a leaked internal error
// string on the tutor screen, and the app's own remedy for a stalled ingest was a
// loop.
//
// Four facts, and each is stated in the register the truth allows:
//
//  · THE KEY — observable, so it is OBSERVED. `hasAnalysisKey()` reads the same
//    environment the cascade reads, so the screen says "found" or "not set yet"
//    about the actual server, and the learner is never told to do something they
//    have already done.
//  · AUTOMATIC ANALYSIS — a promise about behaviour (E-42, D-26): there is no
//    Analyze button, so a recording costs money without anyone pressing anything.
//    That makes disclosing it MORE obligatory, not less.
//  · THE CAP — a real number read from settings, not a slogan. Reserve-before-call
//    means it is a hard ceiling, and saying so is what makes automatic analysis
//    safe to agree to.
//  · THE WORKER — NOT observable on an empty database, and this module refuses to
//    pretend otherwise. Liveness is only detectable by watching a job fail to move
//    (lib/jobs/liveness.ts), and a database with no jobs has nothing to watch. So
//    the worker requirement carries `observed: false` and the copy states the fact
//    and the command rather than inventing a green tick.

export type RequirementId = "key" | "automatic" | "cap" | "worker";

export interface Requirement {
  id: RequirementId;
  /** One short label. */
  title: string;
  /** The plain-prose sentence the learner reads. */
  detail: string;
  /** A shell/file token to render as code, when the fact has one. */
  literal?: string;
  /** True/false only when the server actually checked; null when it cannot know. */
  satisfied: boolean | null;
}

export interface OnboardingView {
  complete: boolean;
  keyPresent: boolean;
  monthlyBudgetUsd: number;
  requirements: Requirement[];
}

/** Format a dollar cap the way the rest of the app does — whole dollars, no cents. */
function capLabel(usd: number): string {
  return `$${Math.round(usd)}`;
}

export function buildOnboardingView(db: Db): OnboardingView {
  const keyPresent = hasAnalysisKey();
  const { monthlyBudgetUsd } = readSettings(db);
  return {
    complete: onboardingComplete(db),
    keyPresent,
    monthlyBudgetUsd,
    requirements: [
      {
        id: "key",
        title: "An OpenAI API key",
        detail: keyPresent
          ? `Found. Erika is reading one from ${ENV_LOCAL}, so listening, lessons and the tutor will work.`
          : `Not set yet. Erika listens to your speech with OpenAI's audio models, so it needs your own key. Put it in ${ENV_LOCAL} at the repo root and restart. Everything below still works without it — you just will not be analysed until it is there.`,
        literal: keyPresent ? undefined : `${REQUIRED_KEY}=sk-…`,
        satisfied: keyPresent,
      },
      {
        id: "automatic",
        title: "Recordings are analysed automatically",
        detail:
          "There is no Analyze button. You record, you confirm once, and Erika listens — which means a recording spends money without you pressing anything.",
        satisfied: null,
      },
      {
        id: "cap",
        title: "There is a monthly cap",
        detail: `Erika will not spend more than ${capLabel(monthlyBudgetUsd)} a month. The cap is checked before every call, not after, so it cannot be overshot. Change it in Settings.`,
        satisfied: null,
      },
      {
        id: "worker",
        title: "A worker process does the listening",
        detail:
          "Recordings are ingested and analysed by a second process, not by this page. Leave it running in a terminal alongside the app, or your recordings will sit and wait.",
        literal: "npm run worker",
        satisfied: null,
      },
    ],
  };
}
