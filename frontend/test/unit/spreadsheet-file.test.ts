/**
 * Reading an uploaded .xlsx or .csv. The workbooks are built here with the
 * test suite's zip writer, laid out the way Google Sheets exports them: shared
 * strings, cells placed by reference with gaps between, and dates stored as
 * day counts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  excelSerialToIsoDate,
  readCsv,
  readSpreadsheet,
  readXlsx,
  unzip,
} from "@/lib/spreadsheet-file";
import { zip } from "../support/zip";

function workbook({
  sheet,
  shared = [],
  date1904 = false,
}: {
  sheet: string;
  shared?: string[];
  date1904?: boolean;
}): Buffer {
  return zip([
    {
      path: "xl/workbook.xml",
      content: `<?xml version="1.0"?><workbook xmlns:r="r">${date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets><sheet name="attendees" sheetId="1" r:id="rId3"/></sheets></workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0"?><Relationships><Relationship Id="rId3" Target="worksheets/attendees.xml"/></Relationships>`,
    },
    {
      path: "xl/sharedStrings.xml",
      content: `<sst>${shared.map((s) => `<si><t xml:space="preserve">${s}</t></si>`).join("")}</sst>`,
    },
    { path: "xl/worksheets/attendees.xml", content: `<worksheet><sheetData>${sheet}</sheetData></worksheet>` },
  ]);
}

describe("readXlsx", () => {
  test("finds the first sheet through the workbook's relationships", () => {
    const sheet = readXlsx(
      workbook({
        shared: ["email", "BTCDate", "a@x.com"],
        sheet:
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>46182.125</v></c></row>',
      }),
    );
    assert.deepEqual(sheet.rows, [
      ["email", "BTCDate"],
      ["a@x.com", 46182.125],
    ]);
    assert.equal(sheet.date1904, false);
  });

  test("places cells by reference, leaving gaps as null, and keeps skipped rows", () => {
    const sheet = readXlsx(
      workbook({
        sheet: '<row r="1"><c r="C1"><v>3</v></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>b</t></is></c></row>',
      }),
    );
    assert.deepEqual(sheet.rows, [[null, null, 3], [], [null, "b"]]);
  });

  test("reads rich text, entities, formula strings, booleans and errors", () => {
    const sheet = readXlsx(
      workbook({
        shared: [],
        sheet:
          '<row r="1">' +
          '<c r="A1" t="str"><f>A2</f><v>{&quot;Score-Exams&quot;:4}</v></c>' +
          '<c r="B1" t="b"><v>1</v></c>' +
          '<c r="C1" t="e"><v>#N/A</v></c>' +
          '<c r="D1" t="inlineStr"><is><r><t>Sales </t></r><r><t>&amp; Ops</t></r></is></c>' +
          "</row>",
      }),
    );
    assert.deepEqual(sheet.rows[0], ['{"Score-Exams":4}', "TRUE", null, "Sales & Ops"]);
  });

  test("notices a 1904-based workbook", () => {
    assert.equal(readXlsx(workbook({ sheet: "", date1904: true })).date1904, true);
  });

  test("refuses a zip that is not a workbook", () => {
    assert.throws(() => readXlsx(zip([{ path: "a.txt", content: "hi" }])), /not an Excel workbook/);
  });
});

describe("unzip", () => {
  test("inflates deflated entries, as Excel and Google Sheets write them", () => {
    // Rewrite a stored entry as deflated: method 8, and the compressed size.
    const content = "hello hello hello hello";
    const stored = zip([{ path: "a.txt", content }]);
    const compressed = deflateRawSync(Buffer.from(content));
    const nameLength = stored.readUInt16LE(26);
    const local = Buffer.concat([stored.subarray(0, 30 + nameLength), compressed]);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);

    const directoryAt = stored.readUInt32LE(stored.length - 22 + 16);
    const directory = Buffer.from(stored.subarray(directoryAt, stored.length - 22));
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(compressed.length, 20);
    const end = Buffer.from(stored.subarray(stored.length - 22));
    end.writeUInt32LE(local.length, 16);

    const files = unzip(Buffer.concat([local, directory, end]));
    assert.equal(files.get("a.txt")?.toString("utf8"), content);
  });

  test("refuses something that is not a zip", () => {
    assert.throws(() => unzip(Buffer.from("just some text, long enough to scan")), /not a zip/);
  });
});

describe("readCsv", () => {
  test("handles quotes, embedded commas and newlines, CRLF, and a BOM", () => {
    const sheet = readCsv('﻿email,BTCIndividualScores\r\na@x.com,"{""a"":1,""b"":2}"\r\n"b@x.com","two\nlines"\r\n');
    assert.deepEqual(sheet.rows, [
      ["email", "BTCIndividualScores"],
      ["a@x.com", '{"a":1,"b":2}'],
      ["b@x.com", "two\nlines"],
    ]);
  });

  test("turns empty fields into null and keeps a last line without a newline", () => {
    assert.deepEqual(readCsv("a,,c\nd").rows, [["a", null, "c"], ["d"]]);
  });
});

describe("readSpreadsheet", () => {
  test("tells .xlsx from .csv by content, not name", () => {
    assert.deepEqual(readSpreadsheet(Buffer.from("email\na@x.com")).rows, [["email"], ["a@x.com"]]);
    assert.deepEqual(
      readSpreadsheet(workbook({ sheet: '<row r="1"><c r="A1"><v>1</v></c></row>' })).rows,
      [[1]],
    );
  });
});

describe("excelSerialToIsoDate", () => {
  test("uses the 1899-12-30 epoch and drops the time of day", () => {
    assert.equal(excelSerialToIsoDate(36526), "2000-01-01");
    // The sheet's dates carry a 03:00 that is a timezone artefact, not a time.
    assert.equal(excelSerialToIsoDate(46182.125), "2026-06-09");
    assert.equal(excelSerialToIsoDate(60), "1900-02-28");
  });

  test("uses 1904-01-01 for a 1904-based workbook", () => {
    assert.equal(excelSerialToIsoDate(0, true), "1904-01-01");
    assert.equal(excelSerialToIsoDate(35064, true), "2000-01-01");
  });
});
