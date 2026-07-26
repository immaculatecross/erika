export const TUTOR_ARCHITECTURES = ["native", "transcript"] as const;
export type TutorArchitecture = (typeof TUTOR_ARCHITECTURES)[number];

export const TUTOR_PRESETS = [
  "record-equivalent",
  "minimal",
  "balanced",
  "precision",
  "current",
] as const;
export type TutorPromptPreset = (typeof TUTOR_PRESETS)[number];

export interface TutorExperimentOption<T extends string> {
  id: T;
  label: string;
  description: string;
}

export const ARCHITECTURE_OPTIONS: readonly TutorExperimentOption<TutorArchitecture>[] = [
  {
    id: "native",
    label: "Native listener — Realtime 2.1",
    description: "Listens directly to your audio, including pronunciation and hesitation.",
  },
  {
    id: "transcript",
    label: "Transcript listener — OpenAI STT + GPT-5.6 Terra",
    description: "Transcribes each turn before coaching, so grammar and word choice can be compared separately.",
  },
];

export const PRESET_OPTIONS: readonly TutorExperimentOption<TutorPromptPreset>[] = [
  {
    id: "record-equivalent",
    label: "Record-equivalent detector",
    description: "Uses Record's full error classes and precision policy, while speaking at most one correction.",
  },
  {
    id: "minimal",
    label: "Minimal detector",
    description: "Tests the detector without learner profile, recurring slips, today's targets, or coaching pressure.",
  },
  {
    id: "balanced",
    label: "Balanced coach",
    description: "Lists every clear error internally, speaks the most useful one, then continues naturally.",
  },
  {
    id: "precision",
    label: "Precision first",
    description: "Corrects only high-confidence errors and asks for repetition when the audio is uncertain.",
  },
  {
    id: "current",
    label: "Current tutor",
    description: "Preserves Erika's current detection and one-correction policy inside the shared result format.",
  },
];

export const DEFAULT_TUTOR_ARCHITECTURE: TutorArchitecture = "native";
export const DEFAULT_TUTOR_PRESET: TutorPromptPreset = "current";

export const TRANSCRIPT_LIMITATION =
  "This path can compare grammar and word choice, but a transcript cannot preserve pronunciation or hesitation.";
export const MAX_TRANSCRIPT_TURN_SECONDS = 120;
export const MAX_TUTOR_REPLY_CHARS = 1200;

export function isTutorArchitecture(value: unknown): value is TutorArchitecture {
  return typeof value === "string" && (TUTOR_ARCHITECTURES as readonly string[]).includes(value);
}

export function isTutorPromptPreset(value: unknown): value is TutorPromptPreset {
  return typeof value === "string" && (TUTOR_PRESETS as readonly string[]).includes(value);
}
