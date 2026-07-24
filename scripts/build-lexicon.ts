// Provenance generator for the committed frequency-lexicon asset (E-26a, D-19). It
// turns two license-clean sources into the reduced, attributed asset the v17 seed
// loads (lib/lexicon/frequency-lexicon.ts) — a one-shot tool kept for
// reproducibility, NOT part of the app, the seed, or CI (those read the committed
// asset). The raw multi-MB sources are NOT committed (CC BY-SA share-alike; see
// lib/lexicon/NOTICE.md).
//
//   git clone --depth 1 https://github.com/hermitdave/FrequencyWords
//   git clone --depth 1 https://github.com/giodegas/morphit-lemmatizer
//   npx tsx scripts/build-lexicon.ts \
//     FrequencyWords/content/2018/it/it_full.txt \
//     morphit-lemmatizer/master/morph-it_048_utf8.txt
//
// Add `--report` to print the survivor count at several frequency floors instead
// of writing the asset (used to choose the cutoff). Pass `--floor <n>` to override
// the aggregated-frequency cutoff (default MIN_AGG_FREQ).
//
// Pipeline (deterministic; the sources are their own oracle, D-13):
//  1. Build a form→{(lemma, POS)} map from Morph-it! (505k `form⟶lemma⟶features`
//     rows), collapsing features to the coarse POS scheme (lib/lexicon/pos.ts).
//  2. Stream FrequencyWords' `word count` lines. Clean each wordform (Italian
//     letters only — drops digits/punctuation/single-symbol/foreign-script junk);
//     look up its morph-it readings; drop PROPN and any (lemma, POS) the E-25
//     validator `attestsLemma` rejects. A wordform with no surviving reading (a
//     name, a foreign intrusion, a form morph-it can't lemmatize) is dropped.
//  3. Distribute each wordform's count EQUALLY across its surviving distinct
//     (lemma, POS) readings (context-free fractional lemmatization — deterministic,
//     avoids inflating ambiguous forms) and sum per (lemma, POS).
//  4. Keep survivors with aggregated frequency ≥ the floor; rank them dense &
//     unique (1 = most frequent; ties by lemma then POS); band by rank; emit gzip.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { morphitTagToPos } from "../lib/lexicon/pos";
import { attestsLemma } from "../lib/lexicon/morphit";
import { ASSET_PATH, rankToBand } from "../lib/lexicon/frequency-lexicon";

// The aggregated-frequency cutoff. Every survivor is already a real Italian
// (lemma, POS) morph-it attests, so the floor's job is only to shed the corpus's
// long noise tail (one-off typos, splitting dust) while KEEPING the advanced/colto
// range an elegant-Italian coach needs. Chosen from the --report distribution.
const MIN_AGG_FREQ = 2;

// Italian orthography: lower-case letters plus the accented vowels (and the rare
// j/k/w/x/y that appear in loanwords morph-it itself lists). Anything else in a
// wordform (digit, punctuation, apostrophe clitic fragment, foreign script) means
// noise for our purposes and the form is skipped before the map lookup.
const WORDFORM_RE = /^[a-zàáâäèéêëìíîïòóôöùúûüç]+$/;

interface Cli {
  freqPath: string;
  morphitPath: string;
  report: boolean;
  floor: number;
}

function parseCli(argv: string[]): Cli {
  const positional: string[] = [];
  let report = false;
  let floor = MIN_AGG_FREQ;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") report = true;
    else if (a === "--floor") floor = Number(argv[++i]);
    else positional.push(a);
  }
  if (positional.length < 2) {
    console.error(
      "usage: tsx scripts/build-lexicon.ts <it_full.txt> <morph-it_048_utf8.txt> [--report] [--floor n]",
    );
    process.exit(2);
  }
  return { freqPath: positional[0], morphitPath: positional[1], report, floor };
}

/** Build form(lowercased) → set of `lemma\tPOS` readings from the Morph-it! table. */
async function buildFormMap(morphitPath: string): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  let rows = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(morphitPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line === "") continue;
    rows += 1;
    const cols = line.split("\t");
    if (cols.length !== 3) continue;
    const form = cols[0].trim().toLowerCase();
    const lemma = cols[1].trim();
    const pos = morphitTagToPos(cols[2].trim());
    if (!form || !lemma || !pos) continue;
    let set = map.get(form);
    if (!set) {
      set = new Set<string>();
      map.set(form, set);
    }
    set.add(`${lemma}\t${pos}`);
  }
  console.error(`morph-it rows read: ${rows}, distinct forms: ${map.size}`);
  return map;
}

interface Aggregation {
  /** `lemma\tPOS` → summed (fractional) frequency. */
  freq: Map<string, number>;
  formsRead: number;
  formsLemmatized: number;
  formsDropped: number;
}

/** Stream the frequency list and aggregate wordform counts up to (lemma, POS). */
async function aggregate(freqPath: string, formMap: Map<string, Set<string>>): Promise<Aggregation> {
  const freq = new Map<string, number>();
  let formsRead = 0;
  let formsLemmatized = 0;
  let formsDropped = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(freqPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line === "") continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) continue;
    const form = parts[0].toLowerCase();
    const count = Number(parts[1]);
    if (!Number.isFinite(count) || count <= 0) continue;
    formsRead += 1;

    if (!WORDFORM_RE.test(form)) {
      formsDropped += 1;
      continue;
    }
    const readings = formMap.get(form);
    if (!readings) {
      formsDropped += 1;
      continue;
    }
    // Keep only clean, attested, non-proper readings.
    const survivors: string[] = [];
    for (const r of readings) {
      const [lemma, pos] = r.split("\t");
      if (pos === "PROPN") continue;
      if (!WORDFORM_RE.test(lemma.toLowerCase())) continue;
      if (!attestsLemma(lemma, pos)) continue;
      survivors.push(r);
    }
    if (survivors.length === 0) {
      formsDropped += 1;
      continue;
    }
    formsLemmatized += 1;
    const share = count / survivors.length;
    for (const r of survivors) freq.set(r, (freq.get(r) ?? 0) + share);
  }
  return { freq, formsRead, formsLemmatized, formsDropped };
}

/** Sort survivors above `floor` into dense-ranked lexicon rows. */
function rankSurvivors(freq: Map<string, number>, floor: number) {
  const kept = [...freq.entries()].filter(([, f]) => f >= floor);
  kept.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // frequency desc
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // then lemma\tPOS asc (deterministic)
  });
  return kept.map(([key], i) => {
    const [lemma, pos] = key.split("\t");
    const rank = i + 1;
    return { lemma, pos, rank, band: rankToBand(rank) };
  });
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const formMap = await buildFormMap(cli.morphitPath);
  const agg = await aggregate(cli.freqPath, formMap);
  console.error(
    `frequency forms read: ${agg.formsRead}, lemmatized: ${agg.formsLemmatized}, dropped: ${agg.formsDropped}`,
  );
  console.error(`distinct (lemma,POS) before floor: ${agg.freq.size}`);

  if (cli.report) {
    for (const floor of [1, 2, 3, 5, 10, 20, 50, 100]) {
      const n = [...agg.freq.values()].filter((f) => f >= floor).length;
      console.error(`  floor ${String(floor).padStart(4)}: ${n} lemmas`);
    }
    return;
  }

  const rows = rankSurvivors(agg.freq, cli.floor);
  const byPos = new Map<string, number>();
  for (const r of rows) byPos.set(r.pos, (byPos.get(r.pos) ?? 0) + 1);
  const posSummary = [...byPos.entries()].sort().map(([p, n]) => `${p}=${n}`).join(" ");

  const header = [
    "# Erika frequency lexicon (E-26a) — DERIVED, license-clean asset. DO NOT hand-edit.",
    "# Source: hermitdave/FrequencyWords OpenSubtitles-2018 it (CC BY-SA) lemmatized",
    "#   through Morph-it! (Baroni & Zanchetta, CC BY-SA 2.0) and summed to lemma freq;",
    "#   every (lemma,POS) validated by the E-25 morph-it gate (attestsLemma). No CC BY-NC",
    "#   data (Kelly/itWaC/spaCy) is present. See lib/lexicon/NOTICE.md.",
    `# Cutoff: aggregated frequency >= ${cli.floor}. Lemmas: ${rows.length}. ${posSummary}`,
    "# Columns: lemma<TAB>POS<TAB>freq_rank<TAB>band  (band = coarse FREQUENCY tier, not measured CEFR)",
  ].join("\n");
  const body = rows.map((r) => `${r.lemma}\t${r.pos}\t${r.rank}\t${r.band}`).join("\n");
  const gz = zlib.gzipSync(Buffer.from(header + "\n" + body + "\n", "utf8"), { level: 9 });
  const out = path.join(process.cwd(), ASSET_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gz);

  console.error(`lemmas emitted: ${rows.length} (floor ${cli.floor})`);
  console.error(`POS breakdown: ${posSummary}`);
  console.error(`wrote ${out} (${gz.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
