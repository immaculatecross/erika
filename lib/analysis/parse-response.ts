import { isSeverity, normalizeCategory, sanitizeNotes } from "./findings";
import { ModelParseError } from "./model-errors";
import type { DeepResult, ProducedLemma, TriageResult } from "./audio-model";

// READING THE MODEL'S REPLY — the pure half of lib/analysis/audio-model.ts.
//
// Extracted (E-42) when the per-finding parser rework pushed that file past the
// 500-line hook. It is a cohesive unit: nothing here makes a network call, touches
// the database, or knows an API key exists — which is exactly why it is the part
// the tests drive hardest. `audio-model.ts` re-exports all of it, so every existing
// importer is unchanged.
//
// The invariant this file exists to hold is stated on `parseDeepResponse`: a model
// reply that names a class we asked for must never cost us the rest of the segment.

/**
 * Extract the JSON object from a model response. These audio models do not
 * support a JSON response_format, so we instruct JSON in the prompt and tolerate
 * a stray markdown fence or surrounding prose: parse as-is, else the first
 * balanced `{…}` slice. Anything else is a truthful parse error.
 */
function asObject(raw: string): Record<string, unknown> {
  const candidates = [raw.trim()];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new ModelParseError("Model response was not a JSON object.");
}

/** Parse a triage response. A missing/non-boolean `flagged` is a truthful error. */
export function parseTriageResponse(raw: string): TriageResult {
  const obj = asObject(raw);
  if (typeof obj.flagged !== "boolean") {
    throw new ModelParseError("Triage response missing a boolean `flagged`.");
  }
  return { flagged: obj.flagged, reason: typeof obj.reason === "string" ? obj.reason : undefined };
}

/** One finding, validated — or null when this finding alone could not be read. */
function parseOneFinding(item: unknown): DeepResult["findings"][number] | null {
  if (typeof item !== "object" || item === null) return null;
  const f = item as Record<string, unknown>;
  for (const key of ["quote", "correction", "explanation"] as const) {
    if (typeof f[key] !== "string" || (f[key] as string).trim() === "") return null;
  }
  const category = normalizeCategory(f.category);
  if (category === null) return null;
  if (!isSeverity(f.severity)) return null;
  const relStartMs = numberOrUndefined(f.relStartMs);
  const relEndMs = numberOrUndefined(f.relEndMs);
  // Optional everywhere (D-13): a missing, empty, or non-string recurrenceId is
  // simply absent — it can never fail the finding, the segment, or the run.
  const recurrenceId =
    typeof f.recurrenceId === "string" && f.recurrenceId.trim() !== ""
      ? f.recurrenceId.trim()
      : undefined;
  // The enriched channel is optional and defensively sanitized (E-28): a malformed
  // or over-generous `notes` object keeps only the three known string fields, and
  // reduces to null otherwise — it never fails the finding.
  const notes = sanitizeNotes(f.notes);
  return {
    quote: (f.quote as string).trim(),
    correction: (f.correction as string).trim(),
    category,
    explanation: (f.explanation as string).trim(),
    severity: f.severity,
    startMs: 0,
    endMs: 0,
    relStartMs,
    relEndMs,
    recurrenceId,
    notes,
  };
}

/**
 * Parse a deep-listen response into validated findings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT [E-42 · spike-6]: **a model reply that names a class we asked for
 * must never cost us the rest of the segment.**
 *
 * This function used to reject the WHOLE reply on any per-finding fault, and that
 * was defended as "never persist half a segment's garbage". Measured against the
 * real API, it was not protecting us from garbage — it was destroying good work:
 * `gpt-audio-1.5` labelled 3 of 27 findings `"vocabulary and word choice"`, the
 * heading of class B in our own prompt, and every OTHER finding in those segments
 * was thrown away with it. The segment was then recorded unreadable, so a later run
 * re-billed the deep call to lose them again. The app's core promise failing
 * silently, on the path this milestone makes automatic.
 *
 * So the failure modes are separated by what they actually tell us:
 *
 *   * STRUCTURAL faults — the reply is not a JSON object, or `findings` is not an
 *     array — still reject the whole reply. Nothing can be salvaged from a shape we
 *     cannot walk, and this is the case `ModelTruncatedError` and the repair retry
 *     exist for.
 *   * PER-FINDING faults — not an object, a blank quote/correction/explanation, an
 *     unreadable category or severity — drop THAT FINDING and let the rest through.
 *     Losing one finding is a small, bounded loss; losing the segment is the product
 *     failing.
 *
 * AND THE OPPOSITE FAILURE, because that is how five v0.6 repairs went wrong: if
 * every finding in a non-empty list is dropped, this throws. Returning `[]` there
 * would persist a completion witness saying "analysed, no mistakes" over a segment
 * the model actually reported mistakes in — a clean bill of health on audio nobody
 * could read, which is exactly the E-16b criterion 5 lie in a new costume. An
 * ALREADY-empty `findings: []` is untouched: that is the model saying the speaker
 * did fine, and it is a real answer.
 */
export function parseDeepResponse(raw: string): DeepResult {
  const obj = asObject(raw);
  if (!Array.isArray(obj.findings)) {
    throw new ModelParseError("Deep response missing a `findings` array.");
  }
  const findings = obj.findings.map(parseOneFinding).filter((f) => f !== null);
  if (obj.findings.length > 0 && findings.length === 0) {
    const err = new ModelParseError(
      `Deep response had ${obj.findings.length} finding(s) and none could be read.`,
    );
    err.shape = `findings=${obj.findings.length} readable=0`;
    throw err;
  }
  return { findings, produced: parseProduced(obj.produced) };
}

/**
 * Extract the optional `produced` lemma list (E-28) defensively: a missing,
 * non-array, or partly-malformed value yields the valid entries only, never an
 * error. Each entry needs a non-empty `lemma` and a `pos` string; morph-it
 * validation (drop of an unattested pair) happens downstream, not here — this
 * layer only shapes the reply. A garbage `produced` can never fail the segment or
 * the run (E-16 d4 / D-13), exactly like `notes`.
 */
export function parseProduced(raw: unknown): ProducedLemma[] {
  if (!Array.isArray(raw)) return [];
  const out: ProducedLemma[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const lemma = typeof r.lemma === "string" ? r.lemma.trim() : "";
    const pos = typeof r.pos === "string" ? r.pos.trim() : "";
    if (lemma !== "" && pos !== "") out.push({ lemma, pos });
  }
  return out;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}
