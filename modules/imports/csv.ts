/**
 * Small RFC 4180-style CSV reader for bulk imports.
 *
 * Supports quoted fields, escaped quotes (`""`), commas and newlines inside
 * quotes, CRLF or LF line endings, and a UTF-8 BOM. It deliberately does not
 * try to guess delimiters or encodings: a file that is not comma-separated is
 * rejected with a header error instead of silently mis-parsing.
 */

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export type CsvRow = {
  /** 1-based line number in the file, so reports match the user's editor. */
  rowNumber: number;
  values: Record<string, string>;
  /** Set when the row's column count differs from the header. */
  malformed: string | null;
};

export type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

type RawRecord = { cells: string[]; line: number };

function readRecords(text: string): RawRecord[] {
  const input = text.replace(/^\uFEFF/, "");
  const records: RawRecord[] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let index = 0;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push({ cells, line: recordLine });
    cells = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      if (char === "\n") line += 1;
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      pushRecord();
      line += 1;
      recordLine = line;
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (inQuotes) {
    throw new CsvParseError("A quoted value is not closed. Check the row for a missing quote.");
  }
  if (field.length > 0 || cells.length > 0) {
    pushRecord();
  }

  return records;
}

export function parseCsv(text: string): ParsedCsv {
  if (!text.trim()) throw new CsvParseError("The file is empty.");
  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
    throw new CsvParseError("The file is larger than 2 MB. Split it into smaller imports.");
  }

  const records = readRecords(text).filter((record) =>
    record.cells.some((cell) => cell.trim() !== ""),
  );
  if (records.length === 0) throw new CsvParseError("The file has no data rows.");

  const headerRecord = records[0];
  if (!headerRecord) throw new CsvParseError("The file has no header row.");

  const headers = headerRecord.cells.map(normaliseHeader);
  if (headers.some((header) => header === "")) {
    throw new CsvParseError("Every column needs a name in the header row.");
  }
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) throw new CsvParseError(`The header "${header}" appears twice.`);
    seen.add(header);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_ROWS) {
    throw new CsvParseError(
      `The file has more than ${MAX_ROWS} rows. Split it into smaller imports.`,
    );
  }

  const rows: CsvRow[] = dataRecords.map((record) => {
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      values[header] = (record.cells[column] ?? "").trim();
    });

    return {
      rowNumber: record.line,
      values,
      malformed:
        record.cells.length === headers.length
          ? null
          : `Expected ${headers.length} columns but found ${record.cells.length}.`,
    };
  });

  return { headers, rows };
}
