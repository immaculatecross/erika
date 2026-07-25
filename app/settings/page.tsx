"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type Settings } from "@/lib/settings";
import { ACTIVE_NEW_ITEM_KNOBS, PENDING_NEW_ITEM_KNOBS } from "@/lib/settings-knobs";
import { REGISTERS, type Register } from "@/lib/register";
import { REALTIME_TIERS, type RealtimeTier } from "@/lib/analysis/rates";
import { formatUsd } from "@/lib/format";

type Status = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

const LABEL = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";
const FIELD =
  "rounded-control border border-hairline bg-card px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";

export default function SettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [spent, setSpent] = useState<number | null>(null);
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(
        ({
          spentThisMonth,
          analysisKeyPresent,
          ...s
        }: Settings & { spentThisMonth: number; analysisKeyPresent: boolean }) => {
          setForm(s);
          setSpent(spentThisMonth);
          setKeyPresent(analysisKeyPresent);
        },
      )
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

      {/* [E-42 criterion 7] WHAT ERIKA NEEDS, AND WHAT IT COSTS — stated once, in
          prose, where a person meets it before anything runs.

          This block is the other half of removing every price tag from the capture
          path. Money left the flow; it did not leave the product. And because
          analysis is now AUTOMATIC — nobody presses anything, so nobody is shown a
          figure at the moment of spending — disclosing the standing cost here is
          more obligatory than it was before, not less. That trade is the whole
          reason removing the estimates is honest rather than merely tidier.

          Before this, the ONLY place a new user learned that an API key was required
          was a leaked internal error string on the tutor screen (RETRO-004 §1). */}
      <section
        data-analysis-disclosure
        className="mb-6 flex flex-col gap-3 rounded-card bg-card p-6 shadow-card"
      >
        <h2 className="text-[22px] font-semibold tracking-tight">What Erika needs</h2>
        <p className="text-[15px] leading-[1.47] text-secondary">
          Erika listens to your recordings with OpenAI&rsquo;s audio models, so she needs an{" "}
          <strong className="font-medium text-ink">OpenAI API key</strong>. Put it in a file called{" "}
          <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-ink dark:bg-white/[0.08]">
            .env.local
          </code>{" "}
          in the project folder, as{" "}
          <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-ink dark:bg-white/[0.08]">
            OPENAI_API_KEY=sk-…
          </code>
          , then restart. Without one your recordings are still saved and their speech still
          extracted — but nothing is analyzed, and that stays true until you add one.
        </p>
        {keyPresent !== null && (
          <p
            data-key-status
            className={`text-[15px] ${keyPresent ? "text-secondary" : "text-medium"}`}
            role="status"
          >
            {keyPresent
              ? "A key is set — analysis will run."
              : "No key is set right now, so analysis will not run."}
          </p>
        )}
        <p className="text-[15px] leading-[1.47] text-secondary">
          <strong className="font-medium text-ink">
            Recordings are analyzed automatically when they finish uploading.
          </strong>{" "}
          There is nothing to start: you record or drop in a file, and Erika does the rest. A ten-minute
          take costs roughly twenty cents of API usage; a full day&rsquo;s audio is a couple of dollars,
          because silence never reaches a model and only the parts that sound off are listened to closely.
        </p>
        <p className="text-[15px] leading-[1.47] text-secondary">
          The <strong className="font-medium text-ink">monthly budget</strong> below is a hard cap on
          that spending, not a warning. When a month reaches it, analysis stops — your recordings are
          kept, their speech is kept, and whatever Erika already heard is kept. Each held recording says
          so and resumes on its own when there is room again, either because you raised the cap or
          because the month rolled over. You never have to upload anything twice.
        </p>
      </section>

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

        {/* The realtime tutor tier (E-34, WO criterion 2): flagship vs the cheaper
            mini. The ONE live tier control — it replaced the dead Model-Tier control
            [RETRO-002 P5]. */}
        <div className="flex flex-col gap-1.5" data-realtime-tier>
          <span className={LABEL}>Tutor voice model</span>
          <div className="inline-flex gap-1 rounded-control border border-hairline p-1">
            {REALTIME_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                data-tier={tier}
                data-selected={form.realtimeTier === tier ? "true" : "false"}
                onClick={() => set("realtimeTier", tier as RealtimeTier)}
                className={`flex-1 rounded-[9px] px-3 py-1.5 text-[15px] capitalize transition-colors ${
                  form.realtimeTier === tier ? "bg-accent text-accent-ink" : "text-secondary"
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-secondary">
            Flagship is the most capable spoken tutor; mini is cheaper per minute.
          </span>
        </div>

        {/* The register dial (E-33, D-23): how Erika phrases Italian — corrections,
            lessons, the tutor voice, and spoken renders. Style only, never
            correctness. Default colto. */}
        <div className="flex flex-col gap-1.5" data-register-dial>
          <span className={LABEL}>Register</span>
          {/* [polish] Four long register names must stay on ONE row at 402px — no wrap;
              the row scrolls horizontally if it can't fit, buttons never break line. */}
          <div className="flex gap-1 overflow-x-auto rounded-control border border-hairline p-1">
            {REGISTERS.map((r) => (
              <button
                key={r}
                type="button"
                data-register={r}
                data-selected={form.register === r ? "true" : "false"}
                onClick={() => set("register", r as Register)}
                className={`flex-1 shrink-0 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[15px] capitalize transition-colors ${
                  form.register === r ? "bg-accent text-accent-ink" : "text-secondary"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-secondary">
            How Erika phrases Italian — corrections, lessons, and the spoken voice. Colto is elevated,
            cultured Italian.
          </span>
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

        {/* The daily composer's new-item caps (E-31): how many new items at the
            knowledge edge enter today's plan, per kind. Whole numbers ≥ 0. */}
        <div className="flex flex-col gap-3 border-t border-hairline pt-4" data-new-item-caps>
          <span className={LABEL}>New items per day</span>
          <div className="grid grid-cols-2 gap-3">
            {ACTIVE_NEW_ITEM_KNOBS.map(({ key, label }) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-[13px] text-secondary">{label}</span>
                <input
                  className={`${FIELD} tabular`}
                  inputMode="numeric"
                  data-cap={key}
                  value={String(form[key])}
                  onChange={(e) => set(key, e.target.value as unknown as Settings[typeof key])}
                />
              </label>
            ))}
          </div>
          {/* [P3a] The pronunciation ("Sounds") cap is inert until E-37 seeds phones —
              shown as a quiet note, never an editable control, so it can't promise an
              item it will never yield. */}
          {PENDING_NEW_ITEM_KNOBS.map(({ key, label, note }) => (
            <p key={key} data-cap-pending={key} className="text-[13px] text-secondary">
              {label} — {note}.
            </p>
          ))}
        </div>

        {/* Re-run placement (E-35). The vocabulary check is re-runnable; a new run
            re-seeds recognition evidence and can record a fresh enrollment take.
            [RETRO-004 §DE-2] This copy used to promise a repair it did not perform: a
            new run left the previous placement's seeded grammar in the daily plan, so
            re-taking it honestly as a beginner still served C2 rules. A later run now
            SUPERSEDES the earlier one, so the sentence below is finally true — and it
            says plainly that the new result replaces the old. */}
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4" data-placement-entry>
          <span className={LABEL}>Placement</span>
          <p className="text-[13px] text-secondary">
            Re-take the quick vocabulary check to re-estimate your level, or record a new enrollment take. The newest
            run replaces the last one — your daily plan follows it.
          </p>
          <Link
            href="/practice/placement"
            data-rerun-placement
            className="mt-1 inline-flex w-fit rounded-full bg-black/[0.06] px-4 py-2 text-[15px] font-medium text-ink transition-transform active:scale-[0.98] dark:bg-white/[0.08]"
          >
            Run placement
          </Link>
        </div>

        {/* Month-to-date spend from spend_ledger (E-18 criterion 4) — display
            only; the cap and every budget check live server-side, untouched.
            Red only when the cap is reached: that state carries meaning. */}
        {spent !== null && (
          <div className="flex flex-col gap-1.5" data-spend>
            <span className={LABEL}>Spent this month</span>
            <p className="tabular text-[15px] text-ink">
              <span data-spent-figure>{formatUsd(spent)}</span>
              <span className="text-secondary"> of {formatUsd(Number(form.monthlyBudgetUsd) || 0)}</span>
              {spent >= (Number(form.monthlyBudgetUsd) || 0) - 1e-9 && (
                <span className="text-severe"> — budget reached</span>
              )}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-hairline" aria-hidden>
              <div
                className="h-full rounded-full bg-accent"
                style={{
                  width: `${Math.min(100, (Number(form.monthlyBudgetUsd) || 0) > 0 ? (spent / Number(form.monthlyBudgetUsd)) * 100 : spent > 0 ? 100 : 0)}%`,
                }}
              />
            </div>
          </div>
        )}

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
