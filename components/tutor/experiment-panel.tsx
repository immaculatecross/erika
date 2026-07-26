"use client";

import {
  ARCHITECTURE_OPTIONS,
  PRESET_OPTIONS,
  type TutorArchitecture,
  type TutorPromptPreset,
} from "@/lib/tutor/experiment";

interface Props {
  architecture: TutorArchitecture;
  preset: TutorPromptPreset;
  disabled: boolean;
  onArchitecture: (value: TutorArchitecture) => void;
  onPreset: (value: TutorPromptPreset) => void;
}

function OptionGroup<T extends string>(props: {
  legend: string;
  name: string;
  value: T;
  disabled: boolean;
  options: readonly { id: T; label: string; description: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2" disabled={props.disabled}>
      <legend className="mb-2 text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
        {props.legend}
      </legend>
      {props.options.map((option) => {
        const selected = option.id === props.value;
        return (
          <label
            key={option.id}
            className={`block cursor-pointer rounded-control p-3 transition-colors ${
              selected
                ? "bg-ink/[0.08] dark:bg-white/[0.12]"
                : "bg-ink/[0.04] hover:bg-ink/[0.08] dark:bg-white/[0.06] dark:hover:bg-white/[0.12]"
            } ${props.disabled ? "cursor-default opacity-60" : ""}`}
          >
            <span className="flex items-start gap-3">
              <input
                className="mt-1 accent-current"
                type="radio"
                name={props.name}
                checked={selected}
                onChange={() => props.onChange(option.id)}
              />
              <span>
                <span className="block text-[15px] font-medium text-ink">{option.label}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-secondary">
                  {option.description}
                </span>
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function ExperimentPanel(props: Props) {
  return (
    <details
      className="w-full rounded-control bg-ink/[0.04] p-4 dark:bg-white/[0.06]"
      data-tutor-experiment
    >
      <summary className="cursor-pointer text-[15px] font-medium text-ink">
        Experiment · listener and prompt
      </summary>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary">
        The selection is fixed once a conversation starts and can change between conversations.
      </p>
      <div className="mt-5 space-y-6">
        <OptionGroup
          legend="Listening path"
          name="tutor-architecture"
          value={props.architecture}
          disabled={props.disabled}
          options={ARCHITECTURE_OPTIONS}
          onChange={props.onArchitecture}
        />
        <OptionGroup
          legend="Prompt preset"
          name="tutor-preset"
          value={props.preset}
          disabled={props.disabled}
          options={PRESET_OPTIONS}
          onChange={props.onPreset}
        />
      </div>
    </details>
  );
}
