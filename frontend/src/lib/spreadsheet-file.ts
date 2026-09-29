/**
 * Reads the first sheet of an uploaded spreadsheet: an Excel `.xlsx` (what
 * Google Sheets downloads as "Microsoft Excel") or a `.csv`.
 *
 * Only cell values are read — no formatting, formulas or other sheets. An
 * `.xlsx` date is a number of days, since that is how the file stores it;
 * `excelSerialToIsoDate` turns one into a date for the columns that hold them.
 */

import { inflateRawSync } from "node:zlib";

export type Cell = string | number | null;

export type Sheet = {
  rows: Cell[][];
  /** Whether day 0 is 1904-01-01 rather than 1899-12-30, for old Mac workbooks. */
  date1904: boolean;
};

// ─── ZIP ────────────────────────────────────────────────────────────────────

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** Every file in a ZIP archive, by path. Throws on anything malformed. */
export function unzip(archive: Buffer): Map<string, Buffer> {
  // The end-of-directory record is the last thing in the file, followed only
  // by a comment of up to 64 KiB.
  let end = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
    if (archive.readUInt32LE(i) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive");

  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();

  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new Error("bad zip directory");
    const method = archive.readUInt16LE(at + 10);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (archive.readUInt32LE(local) !== LOCAL_HEADER) throw new Error("bad zip entry");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + size);

    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`unsupported zip compression ${method}`);
  }
  return files;
}

// ─── XLSX ───────────────────────────────────────────────────────────────────

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) => {
    const e = entity.toLowerCase();
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function attr(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match ? decodeXml(match[1]!) : null;
}

/** The text of every `<t>` inside `xml`, joined — a rich-text run is several. */
function textRuns(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    text += decodeXml(match[1]!);
  }
  return text;
}

/** `B12` → 1: the zero-based column of a cell reference. */
function columnOf(ref: string): number {
  let column = 0;
  for (const ch of ref.toUpperCase()) {
    if (ch < "A" || ch > "Z") break;
    column = column * 26 + (ch.charCodeAt(0) - 64);
  }
  return column - 1;
}

/** The path of the workbook's first sheet, following its relationship id. */
function firstSheetPath(files: Map<string, Buffer>): string {
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const sheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  const relId = sheet ? attr(sheet[1]!, "r:id") : null;
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";

  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    if (attr(match[1]!, "Id") !== relId) continue;
    const target = attr(match[1]!, "Target") ?? "";
    return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  return "xl/worksheets/sheet1.xml";
}

export function readXlsx(bytes: Buffer): Sheet {
  const files = unzip(bytes);
  const workbook = files.get("xl/workbook.xml")?.toString("utf8");
  if (!workbook) throw new Error("not an Excel workbook");

  const shared: string[] = [];
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const match of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    shared.push(match[1] === undefined ? "" : textRuns(match[1]));
  }

  const sheetXml = files.get(firstSheetPath(files))?.toString("utf8");
  if (sheetXml === undefined) throw new Error("the workbook has no sheets");

  const rows: Cell[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rowMatch[1]!, "r"));
    const row: Cell[] = [];
    let next = 0;

    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1]!;
      const body = cellMatch[2] ?? "";
      const ref = attr(attributes, "r");
      const column = ref ? columnOf(ref) : next;
      next = column + 1;

      const type = attr(attributes, "t");
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === "inlineStr") value = textRuns(body);
      else if (raw === undefined) value = null;
      else if (type === "s") value = shared[Number(raw)] ?? null;
      else if (type === "str") value = decodeXml(raw);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = null;
      else value = Number.isFinite(Number(raw)) ? Number(raw) : decodeXml(raw);

      while (row.length < column) row.push(null);
      row[column] = value;
    }

    const index = Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : rows.length;
    while (rows.length < index) rows.push([]);
    rows[index] = row;
  }

  return { rows, date1904: /\bdate1904="(1|true)"/.test(workbook) };
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/** RFC 4180: commas, double-quoted fields, `""` for a quote inside one. */
export function readCsv(text: string): Sheet {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.map((r) => r.map((c) => (c === "" ? null : c))), date1904: false };
}

// ─── Either ─────────────────────────────────────────────────────────────────

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** An `.xlsx` or `.csv`, told apart by content rather than by name. */
export function readSpreadsheet(bytes: Buffer): Sheet {
  return bytes.subarray(0, 4).equals(ZIP_MAGIC) ? readXlsx(bytes) : readCsv(bytes.toString("utf8"));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

/**
 * An Excel date serial as `YYYY-MM-DD`. The fraction — the time of day — is
 * dropped, so 2026-06-09 03:00 is 2026-06-09.
 */
export function excelSerialToIsoDate(serial: number, date1904 = false): string {
  const ms = (date1904 ? EPOCH_1904 : EPOCH_1900) + Math.floor(serial) * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}
