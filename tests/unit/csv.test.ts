import { describe, expect, it } from "vitest";

import { CsvParseError, parseCsv } from "@/modules/imports/csv";

describe("CSV import parser", () => {
  it("reads headers, quoted commas, escaped quotes, and line numbers", () => {
    const parsed = parseCsv(
      'email,name\n"a@example.edu","Doe, Jane"\nb@example.edu,"He said ""hello"""\n',
    );

    expect(parsed.headers).toEqual(["email", "name"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.values.name).toBe("Doe, Jane");
    expect(parsed.rows[1]?.values.name).toBe('He said "hello"');
    expect(parsed.rows[0]?.rowNumber).toBe(2);
    expect(parsed.rows[1]?.rowNumber).toBe(3);
    expect(parsed.rows.every((row) => row.malformed === null)).toBe(true);
  });

  it("accepts CRLF, a BOM, normalised headers, and blank lines", () => {
    const parsed = parseCsv(
      "\uFEFFEmail Address , Course Code\r\na@example.edu,CS101\r\n\r\nb@example.edu,BUS101\r\n",
    );

    expect(parsed.headers).toEqual(["email_address", "course_code"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.values.email_address).toBe("a@example.edu");
  });

  it("flags a row whose column count differs from the header", () => {
    const parsed = parseCsv("email,name\na@example.edu\nb@example.edu,Bee\n");

    expect(parsed.rows[0]?.malformed).toContain("Expected 2 columns but found 1");
    expect(parsed.rows[1]?.malformed).toBeNull();
  });

  it("keeps newlines inside quoted fields", () => {
    const parsed = parseCsv('email,note\na@example.edu,"line one\nline two"\n');

    expect(parsed.rows[0]?.values.note).toBe("line one\nline two");
    expect(parsed.rows[0]?.rowNumber).toBe(2);
  });

  it("rejects an empty file, duplicate headers, and an unclosed quote", () => {
    expect(() => parseCsv("   \n")).toThrow(CsvParseError);
    expect(() => parseCsv("email,email\na,b\n")).toThrow(/appears twice/);
    expect(() => parseCsv('email,name\n"unclosed,x\n')).toThrow(/not closed/);
  });

  it("treats alphanumeric institutional IDs as text", () => {
    const parsed = parseCsv("email,institutional_id\na@example.edu,00123\n");

    expect(parsed.rows[0]?.values.institutional_id).toBe("00123");
  });
});
