// Pure CSV serialization for the Anki export (E-5b). No DB, no framework — the
// export route just streams this module's output — so the RFC 4180 escaping is
// unit-testable in isolation and round-trips: a field with a comma, a double
// quote, or a newline is quoted and its quotes doubled, so Anki imports it intact.
//
// The file carries Anki's `#` directive lines (separator + plain-text fields) and
// then one `front,back` record per card — no textual "Front,Back" header row,
// which Anki would otherwise import as a literal note. Anki maps the first column
// to Front and the second to Back by position.

/** A card reduced to the two fields the export writes. */
export interface CsvCard {
  front: string;
  back: string;
}

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
export const CSV_FILENAME = "erika-cards.csv";

// RFC 4180 record separator. Anki accepts CRLF or LF; CRLF is the spec default.
const CRLF = "\r\n";
// Directives Anki reads to set up the import deterministically: comma-separated,
// fields are plain text (a field's newline stays a newline, never parsed as HTML).
const DIRECTIVES = ["#separator:Comma", "#html:false"];

/** Quote a field per RFC 4180 iff it holds a comma, a double quote, or a newline. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize one record: escape each field and join with commas (no line ending). */
export function serializeCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** Serialize all cards to the full Anki-importable file (directives + records). */
export function cardsToCsv(cards: CsvCard[]): string {
  const lines = [...DIRECTIVES, ...cards.map((c) => serializeCsvRow([c.front, c.back]))];
  return lines.join(CRLF) + CRLF;
}

/**
 * Parse RFC 4180 text back into records — the round-trip witness for the tests
 * (and a faithful model of how Anki reads a quoted field with embedded commas,
 * doubled quotes, and newlines). `#` directive lines are skipped, as Anki skips
 * them. Records are separated by LF or CRLF outside of quotes.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // did the current record accumulate any field yet?

  const endField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRecord = () => {
    endField();
    records.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; started = true; continue; }
    if (c === ",") { endField(); continue; }
    if (c === "\r") continue; // fold CRLF: the LF ends the record
    if (c === "\n") { endRecord(); continue; }
    field += c;
    started = true;
  }
  if (started || field.length > 0) endRecord();

  return records.filter((r) => !(r.length === 1 && r[0].startsWith("#")));
}
