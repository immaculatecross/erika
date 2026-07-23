// Provenance generator for the committed morph-it lemma asset (E-25). It reduces
// the raw ~505k-row morph-it wordform table to the distinct, POS-mapped set of
// (lemma, POS) pairs the canonical-lemma validator needs, and writes it gzipped to
// lib/lexicon/morphit-lemmas.tsv.gz — a license-clean, ~130 KB asset committed to
// the repo (the raw 19 MB file is NOT committed; CC BY-SA share-alike, see
// lib/lexicon/NOTICE.md). It is a one-shot tool kept for reproducibility, not part
// of the app or the test path — those read the committed asset (lib/lexicon/morphit.ts).
//
//   npx tsx scripts/build-morphit-lemmas.ts <path-to-morph-it_048_utf8.txt>
//
// The raw file is tab-separated `form⟶lemma⟶features`. A malformed row (not three
// tab fields, or a feature tag that maps to no lexical POS) is skipped, never
// fatal (D-13 external-input isolation).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { morphitTagToPos } from "../lib/lexicon/pos";
import { ASSET_PATH } from "../lib/lexicon/morphit";

async function main(): Promise<void> {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: tsx scripts/build-morphit-lemmas.ts <morph-it_048_utf8.txt>");
    process.exit(2);
  }

  const pairs = new Set<string>();
  let rows = 0;
  let skipped = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(src), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line === "") continue;
    rows += 1;
    const cols = line.split("\t");
    if (cols.length !== 3) {
      skipped += 1;
      continue;
    }
    const lemma = cols[1].trim();
    const pos = morphitTagToPos(cols[2].trim());
    if (!lemma || !pos) {
      skipped += 1;
      continue;
    }
    pairs.add(`${lemma}\t${pos}`);
  }

  const sorted = [...pairs].sort();
  const body = sorted.join("\n") + "\n";
  const gz = zlib.gzipSync(Buffer.from(body, "utf8"), { level: 9 });
  const out = path.join(process.cwd(), ASSET_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gz);

  // Progress goes to stderr — this is a one-shot dev tool, not app output.
  console.error(`rows read: ${rows}, skipped: ${skipped}, distinct (lemma,POS): ${sorted.length}`);
  console.error(`wrote ${out} (${gz.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
