"use client";

import { useEffect, useState } from "react";
import type { KnowledgeInspection } from "@/lib/knowledge/inspector";

// [RETRO-002 T2] The dev-only knowledge inspector page. A plain diagnostic table —
// deliberately unstyled-to-DESIGN because it is NOT a product surface (it never
// ships to users; the route it reads 404s in production). It answers "does the
// composer's new-item exclusion have real data?" at a glance: the produced-lemma
// yield, the item-status spread, and the composer's live pool sizes.

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-control bg-card px-4 py-3 shadow-card">
      <div className={CAPTION}>{label}</div>
      <div className="tabular mt-1 text-[22px] font-semibold text-ink">{value}</div>
    </div>
  );
}

export default function KnowledgeInspectorPage() {
  const [data, setData] = useState<KnowledgeInspection | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/api/dev/knowledge")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: KnowledgeInspection) => setData(d))
      .catch(() => setErr(true));
  }, []);

  if (err) return <div className="p-8 text-[15px] text-secondary">Inspector unavailable (production build).</div>;
  if (!data) return <div className="p-8 text-[15px] text-secondary">Loading knowledge inspector…</div>;

  const y = data.yield;
  const attestRate = y.emitted > 0 ? `${Math.round((y.attested / y.emitted) * 100)}%` : "—";

  return (
    <div data-knowledge-inspector className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-[28px] font-bold tracking-tight">Knowledge inspector</h1>
        <p className="mt-1 text-[15px] text-secondary">Dev-only. Not a user surface.</p>
      </header>

      <section className="flex flex-col gap-3">
        <span className={CAPTION}>Produced-lemma yield (cumulative)</span>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Emitted" value={y.emitted} />
          <Stat label="Attested" value={y.attested} />
          <Stat label="Dropped" value={y.dropped} />
          <Stat label="Attest rate" value={attestRate} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <span className={CAPTION}>Composer new-item pools</span>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Unseen vocab" value={data.composerPool.unseenVocab} />
          <Stat label="Unseen rules" value={data.composerPool.unseenRules} />
          <Stat label="Unseen phones" value={data.composerPool.unseenPhones} />
        </div>
        <p className="text-[13px] text-secondary">
          Recording-attested items (excluded from new-item selection): {data.recordingAttested}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <span className={CAPTION}>Knowledge items by status</span>
        <div className="overflow-x-auto rounded-card bg-card p-4 shadow-card">
          <table className="w-full text-left text-[15px] tabular">
            <thead>
              <tr className="text-secondary">
                <th className="py-1 pr-6 font-medium">Kind</th>
                <th className="py-1 pr-6 font-medium">Status</th>
                <th className="py-1 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {data.itemsByKindStatus.map((r) => (
                <tr key={`${r.kind}-${r.status}`} className="text-ink">
                  <td className="py-1 pr-6">{r.kind}</td>
                  <td className="py-1 pr-6">{r.status}</td>
                  <td className="py-1">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <span className={CAPTION}>Evidence log</span>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Rows" value={data.evidence.total} />
          <Stat label="Positive" value={data.evidence.positive} />
        </div>
        <p className="text-[13px] text-secondary">
          By source: {data.evidence.bySource.map((s) => `${s.source} ${s.count}`).join(" · ") || "none"}
        </p>
        <p className="text-[13px] text-secondary">
          By mode: {data.evidence.byMode.map((m) => `${m.mode} ${m.count}`).join(" · ") || "none"}
        </p>
      </section>
    </div>
  );
}
