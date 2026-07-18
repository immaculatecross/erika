import { describe, expect, it } from "vitest";
import {
  cardsToCsv,
  escapeCsvField,
  parseCsv,
  serializeCsvRow,
  type CsvCard,
} from "@/lib/cards-csv";

// The Anki CSV serializer (E-5b criterion 4). Pure — no DB, no framework — so the
// RFC 4180 escaping is proven by round-trip: a field with a comma, a double quote,
// and a newline serializes and parses back to exactly the original string.

const NASTY = 'he said, "I have 20 years"\nand left'; // comma + quote + newline in one field

describe("escapeCsvField", () => {
  it("leaves a plain field untouched and quotes only when it must", () => {
    expect(escapeCsvField("goes to work")).toBe("goes to work");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('a"b')).toBe('"a""b"'); // embedded quotes are doubled
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
  });
});

describe("serializeCsvRow / parseCsv round-trip", () => {
  it("round-trips a field carrying a comma, a quote, AND a newline", () => {
    const fields = [NASTY, "plain back"];
    const parsed = parseCsv(serializeCsvRow(fields));
    expect(parsed).toEqual([fields]); // byte-for-byte the original fields
  });
});

describe("cardsToCsv", () => {
  const cards: CsvCard[] = [
    { front: NASTY, back: "recast\n\nwhy" },
    { front: "simple", back: "fine" },
  ];

  it("round-trips every card's Front and Back through the full file", () => {
    const records = parseCsv(cardsToCsv(cards)); // parseCsv drops the '#' directives
    expect(records).toEqual([
      [NASTY, "recast\n\nwhy"],
      ["simple", "fine"],
    ]);
  });

  it("emits Anki directive lines and no textual Front,Back header", () => {
    const text = cardsToCsv(cards);
    expect(text).toContain("#separator:Comma");
    expect(text).not.toMatch(/^Front,Back/m); // a header row would import as a bogus note
  });
});
