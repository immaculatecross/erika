"use client";

import { useEffect, useState } from "react";
import { MODEL_TIERS, type ModelTier, type Settings } from "@/lib/settings";

type Status = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

const LABEL = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";
const FIELD =
  "rounded-control border border-hairline bg-card px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";

export default function SettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Settings) => setForm(s))
      .catch(() => setStatus({ kind: "error", message: "Could not load settings." }));
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setStatus({ kind: "idle" });
  }

  async function save() {
    if (!form) return;
    setStatus({ kind: "saving" });
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus({ kind: "error", message: data.error ?? "Save failed." });
      return;
    }
    setForm(data as Settings);
    setStatus({ kind: "saved" });
  }

  if (!form) {
    return <div className="p-8 text-[15px] text-secondary">Loading settings…</div>;
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-6 text-[34px] font-bold tracking-tight">Settings</h1>
      <div className="flex flex-col gap-5 rounded-card bg-card p-6 shadow-card">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Target language</span>
          <input
            className={FIELD}
            value={form.targetLanguage}
            onChange={(e) => set("targetLanguage", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Native language</span>
          <input
            className={FIELD}
            value={form.nativeLanguage}
            onChange={(e) => set("nativeLanguage", e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Model tier</span>
          <div className="inline-flex gap-1 rounded-control border border-hairline p-1">
            {MODEL_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                data-selected={form.modelTier === tier ? "true" : "false"}
                onClick={() => set("modelTier", tier as ModelTier)}
                className={`flex-1 rounded-[9px] px-3 py-1.5 text-[15px] capitalize transition-colors ${
                  form.modelTier === tier ? "bg-accent text-accent-ink" : "text-secondary"
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Monthly budget (USD)</span>
          <input
            className={`${FIELD} tabular`}
            inputMode="decimal"
            value={String(form.monthlyBudgetUsd)}
            onChange={(e) =>
              set("monthlyBudgetUsd", e.target.value as unknown as Settings["monthlyBudgetUsd"])
            }
          />
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={status.kind === "saving"}
            className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {status.kind === "saving" ? "Saving…" : "Save"}
          </button>
          {status.kind === "saved" && (
            <span className="text-[13px]" style={{ color: "#34C759" }} role="status">
              Saved
            </span>
          )}
          {status.kind === "error" && (
            <span className="text-[13px]" style={{ color: "#FF3B30" }} role="alert">
              {status.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
