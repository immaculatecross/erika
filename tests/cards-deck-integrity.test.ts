import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { persistSegmentFindings, type NewFinding } from "@/lib/analysis/findings";
import { listIncludedFindings } from "@/lib/findings-model";
import {
  countDueCards,
  createCardForFinding,
  generateCards,
  listCardBrowserViews,
  listDueCardViews,
  pinFinding,
  retireUnanswerableCards,
} from "@/lib/cards";

// E-45 — the deck's two integrity rules, at the database level:
//
//   * criterion 6: `pinFinding` reads findings through the E-17 gate
//     (lib/findings-model.ts), the last site in the repo that read the table raw;
//   * criterion 3, the half a pure test cannot reach: a card minted BEFORE E-45
//     whose front would now degrade must leave the queue, not merely fail to
//     render. An invisible card that is still COUNTED is a drills step that can
//     never be completed — a wall, which is the failure mode E-44's session
//     contract exists to forbid.
//
// A real SQLite file per test, torn down after.

const dirs: string[] = [];

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-deck-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A localized, cardable finding: "ieri ho andato al mare" → "ieri sono andato al mare". */
function cardable(over: Partial<NewFinding> = {}): NewFinding {
  return {
    quote: "ieri ho andato al mare",
    correction: "ieri sono andato al mare",
    category: "grammar",
    explanation: "andare takes essere.",
    severity: "high",
    startMs: 1000,
    endMs: 2000,
    ...over,
  };
}

let seq = 0;

/**
 * Seed findings. `analysed` decides whether the segment carries a COMPLETE
 * analysis witness — an un-analysed one is exactly what `INCLUDED_FINDING_SCOPE`
 * excludes, and is the input criterion 6's gate exists for.
 */
function seed(db: Db, findings: NewFinding[], opts: { analysed?: boolean; sessionId?: string } = {}): void {
  const sessionId = opts.sessionId ?? `s${seq}`;
  const analysed = opts.analysed ?? true;
  createSession(db, { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  for (const f of findings) {
    persistSegmentFindings(db, {
      sessionId,
      contentHash: `${sessionId}-h${seq++}`,
      flagged: true,
      // deepDone: false leaves a FLAGGED segment with no completed deep pass, so its
      // witness is incomplete and the E-17 scope excludes its findings.
      deepDone: analysed,
      findings: [f],
    });
  }
}

function findingIdByQuote(db: Db, quote: string): string {
  return (db.prepare("SELECT id FROM findings WHERE quote = ?").get(quote) as { id: string }).id;
}

describe("criterion 6 — pinFinding goes through the E-17 gate", () => {
  it("refuses a finding the canonical scope excludes", () => {
    const db = freshDb();
    seed(db, [cardable({ quote: "ieri ho venuto qui" , correction: "ieri sono venuto qui" })], { analysed: false });
    const id = findingIdByQuote(db, "ieri ho venuto qui");

    // Ground truth from the fixture: this finding is NOT in the canonical scope.
    expect(listIncludedFindings(db).map((f) => f.id)).not.toContain(id);

    // MUTATION ANCHOR: read the row raw instead of through `getIncludedFinding`
    // and this flips to "pinned", because the row exists — that is precisely the
    // pre-E-45 behaviour.
    expect(pinFinding(db, id).status).toBe("not_found");
    expect(createCardForFinding(db, id)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards").get()).toEqual({ n: 0 });
  });

  it("still pins every finding a user can actually reach — the gate changes no surface", () => {
    const db = freshDb();
    seed(db, [cardable(), cardable({ quote: "una problema", correction: "un problema", explanation: "masculine" })]);

    // The Phrasebook — the only surface that offers a pin — lists exactly the
    // included scope. So the set a user can pin is unchanged by the gate: every
    // included, cardable finding still pins.
    const included = listIncludedFindings(db);
    expect(included).toHaveLength(2);
    for (const f of included) {
      expect(pinFinding(db, f.id).status).toBe("pinned");
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards").get()).toEqual({ n: 2 });
  });
});

describe("criterion 3 — an unanswerable card never sits in the queue", () => {
  /** The two known-bad shapes, plus the Amendment 1 collision, as findings. */
  const BAD: { name: string; finding: NewFinding }[] = [
    { name: "single-word fix (no context at all)", finding: cardable({ quote: "gatto", correction: "gatta" }) },
    {
      name: "whole-sentence rewrite (shares no leading or trailing token)",
      finding: cardable({ quote: "boh", correction: "non saprei proprio come risponderti", category: "phrasing" }),
    },
    { name: "pure deletion", finding: cardable({ quote: "non ho visto niente mai", correction: "non ho visto niente" }) },
    {
      name: "register slip leaving only a negation particle",
      finding: cardable({ quote: "Non voglio", correction: "Non desidero", category: "vocabulary" }),
    },
    {
      name: "Amendment 1 — grammar-labelled blurred final vowel",
      finding: cardable({ quote: "la ragazza è stanca", correction: "la ragazza è stanca" }),
    },
  ];

  for (const { name, finding } of BAD) {
    it(`mints no card for: ${name}`, () => {
      const db = freshDb();
      seed(db, [finding, cardable()]);
      // Exactly one card, and it is the good one — asserted POSITIVELY, so "no bad
      // card" cannot be satisfied by minting no cards at all.
      expect(generateCards(db)).toBe(1);
      const fronts = listDueCardViews(db).map((c) => c.front);
      expect(fronts).toEqual(["ieri ____ andato al mare"]);
      // …and the deliberate pin refuses it too, from the same rule.
      const outcome = pinFinding(db, findingIdByQuote(db, finding.quote));
      expect(outcome.status).toBe("not_cardable");
      // The REASON is what the learner is told and where they are sent. Expected
      // from the fixture: only the blurred final vowel is a sound problem.
      const soundProblem = finding.quote === finding.correction;
      expect(outcome).toMatchObject({ reason: soundProblem ? "pronunciation" : "no_answerable_front" });
    });
  }

  it("retires a legacy card whose front would degrade — and drops it from the COUNT", () => {
    const db = freshDb();
    // Two findings. Seed the deck the way a pre-E-45 database looks: a card row
    // exists for BOTH, including the whole-rewrite one that used to front
    // "____ · phrasing".
    seed(db, [cardable(), cardable({ quote: "boh", correction: "non saprei come dirlo", category: "phrasing" })]);
    const legacyId = findingIdByQuote(db, "boh");
    db.prepare(
      `INSERT INTO cards (id, finding_id, session_id, front, back, category, start_ms, ease, interval_days, repetitions, due, suspended)
       VALUES ('legacy', ?, (SELECT session_id FROM findings WHERE id = ?), 'boh', 'x', 'phrasing', 0, 2.5, 0, 0, datetime('now'), 0)`,
    ).run(legacyId, legacyId);

    // Before the sweep: the legacy row is due and counted, but cannot be rendered.
    expect(countDueCards(db)).toBe(1);
    expect(listDueCardViews(db)).toHaveLength(0); // ← invisible AND counted: the wall

    // `generateCards` is the ONLY card call the session planner makes, so the sweep
    // has to happen inside it — running it by hand in a test would leave the real
    // path unswept and this assertion unable to fail.
    expect(generateCards(db)).toBe(1); // the good finding still becomes a card

    // After: the count and the queue agree again, so a drills step can complete.
    expect(countDueCards(db)).toBe(1);
    expect(listDueCardViews(db)).toHaveLength(1);

    // Retirement is SUSPENSION, not deletion: the row survives, so a later
    // milestone that learns to write a front for it can bring it back.
    const row = db.prepare("SELECT suspended FROM cards WHERE id = 'legacy'").get();
    expect(row).toEqual({ suspended: 1 });
    // And the browser never shows it, because a view it cannot render is not a view.
    expect(listCardBrowserViews(db).map((c) => c.front)).toEqual(["ieri ____ andato al mare"]);
    // Idempotent: a second sweep retires nothing.
    expect(retireUnanswerableCards(db)).toBe(0);
  });
});
