import { ModelParseError } from "../analysis/model-errors";
import { BANDS, type Band } from "../placement/scoring";

// The pure half of the spoken placement prompt (E-46 criteria 3, 10, 11). Kept
// away from the network so the shape of every reply the model can send — good,
// hedged, malformed, hostile — is testable without a call.
//
// What this is for, stated exactly, because the temptation to overclaim here is
// strong. The vocabulary check measures RECOGNITION and can be defeated by a
// yes-biased learner: say "yes" to everything, including the invented words, and
// the scorer correctly refuses to measure you at all (`response-style`). Until now
// that refusal had no exit but taking the same check again — the last open item of
// RETRO-004 §1. A short spoken sample is a second, INDEPENDENT measurement, of
// PRODUCTION rather than recognition, and a response style cannot fake it.
//
// It is deliberately coarse: one CEFR band and one confidence flag. Anything finer
// would be a claim about phonology or grammar that a 45-second sample and a
// non-specialist model cannot support (the D-21 honesty limit, applied to level).

export interface SpokenPlacement {
  /** The band the model heard, or null when it would not commit to one. */
  band: Band | null;
  /** The model's own claim that the sample was long and clear enough to judge. */
  usable: boolean;
}

function coerceBand(raw: unknown): Band | null {
  if (typeof raw !== "string") return null;
  const up = raw.trim().toUpperCase();
  return (BANDS as readonly string[]).includes(up) ? (up as Band) : null;
}

/**
 * Read the spoken-placement reply. Anything that is not an object is a parse
 * failure (it resolved and billed, so the caller must finalize the charge — the
 * `ModelParseError` contract of `reservedCall`); anything inside it that is not a
 * band we recognise degrades to "no band", never to a guess.
 */
export function parseSpokenPlacement(raw: string): SpokenPlacement {
  let body: unknown;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ModelParseError("Spoken placement reply was not a JSON object.");
  try {
    body = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ModelParseError("Spoken placement reply was not readable JSON.");
  }
  if (typeof body !== "object" || body === null) {
    throw new ModelParseError("Spoken placement reply was not a JSON object.");
  }
  const r = body as Record<string, unknown>;
  const band = coerceBand(r.level ?? r.band);
  // `usable` is only ever true when the model said so AND named a band it knows —
  // a "usable" verdict with no level is not a measurement, it is a contradiction.
  return { band, usable: r.usable === true && band !== null };
}
