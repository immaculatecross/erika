import type { Db } from "./db";
import type { Category } from "./analysis/findings";
import { listSessions } from "./sessions";
import { findingTallies, listAnalysedSessions } from "./findings-model";
import { CATEGORY_ORDER } from "./analysis-view";
import type { SessionListItem, SessionYield } from "./sessions-list-view";

// The sessions-list read model (E-18 criterion 2): every session annotated with
// what its analysis yielded — analysed speech time, findings count, dominant
// category — plus the two facts the inline-Analyze gate needs (segment count,
// in-flight run). What "analysed" means is NOT decided here: it comes whole from
// lib/findings-model.ts (`listAnalysedSessions` / `findingTallies`), so this list
// can never disagree with Focus, the letter, or the session report about which
// sessions have evidence. A fixed number of aggregate queries for the whole list
// — never one query per session.

/** Sum a session's tallies into its yield; dominant = most findings, ties by CATEGORY_ORDER. */
function toYield(
  analysedSpeechMs: number,
  counts: ReadonlyMap<Category, number> | undefined,
): SessionYield {
  let findingsCount = 0;
  let dominantCategory: Category | null = null;
  let best = 0;
  if (counts) {
    for (const category of CATEGORY_ORDER) {
      const n = counts.get(category) ?? 0;
      findingsCount += n;
      if (n > best) {
        best = n;
        dominantCategory = category;
      }
    }
  }
  return { analysedSpeechMs, findingsCount, dominantCategory };
}

/**
 * Every session, newest first (the list's existing order), each carrying its
 * yield when analysed. Findings are read ONLY through the canonical read-model's
 * one `GROUP BY` tally; segments and in-flight runs are one aggregate query each.
 */
export function listSessionItems(db: Db): SessionListItem[] {
  const sessions = listSessions(db);
  const analysed = new Map(listAnalysedSessions(db).map((s) => [s.id, s]));

  const countsBySession = new Map<string, Map<Category, number>>();
  for (const t of findingTallies(db)) {
    const bucket = countsBySession.get(t.sessionId) ?? new Map<Category, number>();
    bucket.set(t.category, (bucket.get(t.category) ?? 0) + t.count);
    countsBySession.set(t.sessionId, bucket);
  }

  const segmentCounts = new Map(
    (
      db
        .prepare("SELECT session_id AS sid, COUNT(*) AS n FROM segments GROUP BY session_id")
        .all() as { sid: string; n: number }[]
    ).map((r) => [r.sid, r.n]),
  );

  const pending = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT session_id AS sid FROM analysis_jobs WHERE state IN ('queued', 'processing')",
        )
        .all() as { sid: string }[]
    ).map((r) => r.sid),
  );

  return sessions.map((s) => {
    const a = analysed.get(s.id);
    return {
      ...s,
      segmentCount: segmentCounts.get(s.id) ?? 0,
      analysed: a !== undefined,
      analysisPending: pending.has(s.id),
      sessionYield: a ? toYield(a.analysedSpeechMs, countsBySession.get(s.id)) : null,
    };
  });
}
