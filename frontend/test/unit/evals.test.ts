/**
 * The parts of eVals settings that decide without the database: reading a
 * HiBob employee, walking reporting lines up to the org root, matching titles
 * to lists, and reading a Bootcamp_History sheet.
 *
 * The HiBob record is shaped like a real `people/search` answer with
 * `humanReadable: "APPEND"` — the numeric title code nested, the flattened
 * `/work/title` keys, and the readable copy the title actually comes from.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseHistorySheet } from "@/lib/evals/bootcamp-history-file";
import { hibobAuthorization, toEmployeeRow } from "@/lib/evals/hibob-record";
import { isIsoDay, normalEmail } from "@/lib/evals/history-values";
import { orgUnder, ORG_ROOT_EMAIL } from "@/lib/evals/org";
import { cleanTitle, listForTitle, splitTitles, titleKey, trackFor } from "@/lib/evals/title-lists";
import type { Cell } from "@/lib/spreadsheet-file";

describe("toEmployeeRow", () => {
  const record = {
    id: "3332883894",
    email: "Pat.Doe@Harness.io",
    fullName: "Pat Doe",
    displayName: "Pat",
    work: {
      title: 263339071,
      department: 263342115,
      site: "Remote - US",
      startDate: "2025-06-02",
      activeEffectiveDate: "2026-02-01",
      reportsTo: { email: "Lee.Boss@harness.io", displayName: "Lee Boss", id: "1" },
    },
    "/work/title": { value: 263339071 },
    "/root/email": { value: "Pat.Doe@Harness.io" },
    humanReadable: {
      work: { title: "Senior Sales Engineer", department: "Solutions Engineering", site: "Remote - US" },
    },
  };

  test("takes the readable title and department, and lowercases emails", () => {
    const row = toEmployeeRow(record);
    assert.ok(row);
    assert.equal(row.id, "3332883894");
    assert.equal(row.email, "pat.doe@harness.io");
    assert.equal(row.fullName, "Pat Doe");
    assert.equal(row.title, "Senior Sales Engineer");
    assert.equal(row.department, "Solutions Engineering");
    assert.equal(row.site, "Remote - US");
    assert.equal(row.reportsToEmail, "lee.boss@harness.io");
    assert.equal(row.reportsToName, "Lee Boss");
    assert.equal(row.startDate, "2025-06-02");
    assert.equal(row.activeEffectiveDate, "2026-02-01");
  });

  test("keeps the record without its flattened duplicates", () => {
    const row = toEmployeeRow(record)!;
    assert.ok(!Object.keys(row.raw).some((k) => k.startsWith("/")));
    assert.deepEqual(row.raw.humanReadable, record.humanReadable);
  });

  test("tolerates missing fields, and drops a date that is not ISO", () => {
    const row = toEmployeeRow({ id: 7, email: "a@x.com", work: { startDate: "06/02/2025" } });
    assert.deepEqual(
      { ...row, raw: undefined },
      {
        id: "7",
        email: "a@x.com",
        fullName: "a@x.com",
        title: "",
        department: "",
        site: "",
        reportsToEmail: "",
        reportsToName: "",
        startDate: null,
        activeEffectiveDate: null,
        raw: undefined,
      },
    );
  });

  test("skips a record with no id or email", () => {
    assert.equal(toEmployeeRow({ email: "a@x.com" }), null);
    assert.equal(toEmployeeRow({ id: "1" }), null);
    assert.equal(toEmployeeRow(null), null);
    assert.equal(toEmployeeRow("nope"), null);
  });

  test("builds HiBob's Basic authorization", () => {
    assert.equal(hibobAuthorization("SERVICE-1", "tok"), `Basic ${Buffer.from("SERVICE-1:tok").toString("base64")}`);
  });
});

describe("orgUnder", () => {
  const p = (email: string, reportsToEmail: string) => ({ email, reportsToEmail });

  test("keeps everyone whose chain reaches the root, with that chain", () => {
    const people = [
      p("root@x.com", "ceo@x.com"),
      p("ceo@x.com", ""),
      p("vp@x.com", "root@x.com"),
      p("mgr@x.com", "vp@x.com"),
      p("ic@x.com", "mgr@x.com"),
      p("other@x.com", "ceo@x.com"),
    ];
    const org = orgUnder(people, "root@x.com");
    assert.deepEqual(
      org.map((m) => [m.email, m.chain]),
      [
        ["vp@x.com", ["root@x.com"]],
        ["mgr@x.com", ["vp@x.com", "root@x.com"]],
        ["ic@x.com", ["mgr@x.com", "vp@x.com", "root@x.com"]],
      ],
    );
  });

  test("compares emails case-insensitively and keeps each person's own fields", () => {
    const org = orgUnder([{ email: "A@x.com", reportsToEmail: "ROOT@x.com", name: "A" }], "root@X.com");
    assert.deepEqual(org, [{ email: "A@x.com", reportsToEmail: "ROOT@x.com", name: "A", chain: ["root@x.com"] }]);
  });

  test("drops a chain that loops or leads to someone not imported", () => {
    const org = orgUnder(
      [p("a@x.com", "b@x.com"), p("b@x.com", "a@x.com"), p("c@x.com", "gone@x.com"), p("d@x.com", "")],
      "root@x.com",
    );
    assert.deepEqual(org, []);
  });

  test("defaults to the eVals org root", () => {
    assert.equal(ORG_ROOT_EMAIL, "carlos.delatorre@harness.io");
    assert.equal(orgUnder([p("a@harness.io", ORG_ROOT_EMAIL)]).length, 1);
  });
});

describe("title lists", () => {
  test("clean and compare titles whatever their spacing and case", () => {
    assert.equal(cleanTitle("  Senior   Sales\tEngineer "), "Senior Sales Engineer");
    assert.equal(titleKey("  SENIOR sales  engineer"), "senior sales engineer");
  });

  test("split a pasted column, dropping blanks and repeats but keeping the first spelling", () => {
    assert.deepEqual(splitTitles("Account Executive\r\n\n  account executive \nSDR\n"), ["Account Executive", "SDR"]);
  });

  test("find the list holding a title, and none for a blank one", () => {
    const lists = new Map([["account executive", "sales" as const]]);
    assert.equal(listForTitle(" Account  EXECUTIVE", lists), "sales");
    assert.equal(listForTitle("Engineer", lists), null);
    assert.equal(listForTitle("", lists), null);
  });

  test("give a track only in the org, and exempt over any list", () => {
    const lists = new Map([["account executive", "sales" as const]]);
    const ae = { inOrg: true, title: "Account Executive", exempt: false };
    assert.equal(trackFor(ae, lists), "sales");
    assert.equal(trackFor({ ...ae, exempt: true }, lists), "exempt");
    assert.equal(trackFor({ ...ae, title: "Director", exempt: true }, lists), "exempt");
    assert.equal(trackFor({ ...ae, title: "Director" }, lists), null);
    assert.equal(trackFor({ ...ae, inOrg: false, exempt: true }, lists), null);
  });
});

describe("history values", () => {
  test("an email is trimmed and lowercased, or refused", () => {
    assert.equal(normalEmail("  Pat.Doe@Harness.io "), "pat.doe@harness.io");
    assert.equal(normalEmail("pat doe@harness.io"), null);
    assert.equal(normalEmail("pat"), null);
  });

  test("a day must be written YYYY-MM-DD and exist", () => {
    assert.equal(isIsoDay("2026-02-28"), true);
    assert.equal(isIsoDay("2000-01-01"), true);
    assert.equal(isIsoDay("2026-02-30"), false);
    assert.equal(isIsoDay("2026-2-3"), false);
    assert.equal(isIsoDay("2026-02-28T00:00"), false);
  });
});

describe("parseHistorySheet", () => {
  const HEADER: Cell[] = [
    "email",
    "BTCDate",
    "INTDate",
    "BTCScore",
    "INTScore",
    "BTCIndividualScores",
    "INTIndividualScores",
  ];
  const sheet = (...rows: Cell[][]) => ({ rows: [HEADER, ...rows], date1904: false });

  test("reads every column of a real-looking row", () => {
    const parsed = parseHistorySheet(
      sheet(["Pat.Doe@harness.io", 46182.125, "2026-08-04", 4, "3", '{"Score-Exams":4,"Score-Lab":4.5}', null]),
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.rows, [
      {
        email: "pat.doe@harness.io",
        btcDate: "2026-06-09",
        intDate: "2026-08-04",
        btcScore: 4,
        intScore: 3,
        btcIndividualScores: { "Score-Exams": 4, "Score-Lab": 4.5 },
        intIndividualScores: null,
      },
    ]);
    assert.deepEqual(parsed.columns, [
      "btcDate",
      "intDate",
      "btcScore",
      "intScore",
      "btcIndividualScores",
      "intIndividualScores",
    ]);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(parsed.ignoredColumns, []);
  });

  test("reads the exempt marker, US-style dates, and a serial written as text", () => {
    const parsed = parseHistorySheet(sheet(["a@x.com", 36526, "6/9/2026 3:00:00"], ["b@x.com", "46182.125", "0"]));
    assert.ok(parsed.ok);
    assert.equal(parsed.rows[0]!.btcDate, "2000-01-01");
    assert.equal(parsed.rows[0]!.intDate, "2026-06-09");
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.problems, [{ row: 3, message: "b@x.com: unreadable INTDate" }]);
  });

  test("finds columns by name in any order and case, and reports the rest", () => {
    const parsed = parseHistorySheet({
      rows: [
        [null, null],
        ["Notes", "int_date", "EMAIL"],
        ["hi", "2026-01-05", "a@x.com"],
      ],
      date1904: false,
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.ignoredColumns, ["Notes"]);
    // Only INTDate is written; the stored BTC results are the sheet's to leave alone.
    assert.deepEqual(parsed.columns, ["intDate"]);
    assert.equal(parsed.rows[0]!.intDate, "2026-01-05");
    assert.equal(parsed.rows[0]!.btcDate, null);
  });

  test("skips blank rows silently and bad ones with a reason, naming the sheet's row", () => {
    const parsed = parseHistorySheet(
      sheet(
        [null, null, null],
        ["not-an-email", 46000],
        [null, 46000],
        ["b@x.com", "someday", null, "high"],
        ["c@x.com", null, null, null, null, "[1,2]"],
        ["d@x.com", "2026-02-30"],
      ),
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.problems, [
      { row: 3, message: "“not-an-email” is not an email address" },
      { row: 4, message: "no email" },
      { row: 5, message: "b@x.com: unreadable BTCDate, BTCScore" },
      { row: 6, message: "c@x.com: unreadable BTCIndividualScores" },
      { row: 7, message: "d@x.com: unreadable BTCDate" },
    ]);
  });

  test("takes a class score only as a whole number from 1 to 4", () => {
    const parsed = parseHistorySheet(
      sheet(
        ["a@x.com", null, null, 1, "4"],
        ["b@x.com", null, null, 0],
        ["c@x.com", null, null, 5],
        ["d@x.com", null, null, 3.5],
      ),
    );
    assert.ok(parsed.ok);
    assert.deepEqual(
      parsed.rows.map((r) => [r.btcScore, r.intScore]),
      [[1, 4]],
    );
    assert.deepEqual(
      parsed.problems.map((p) => p.message),
      ["b@x.com: unreadable BTCScore", "c@x.com: unreadable BTCScore", "d@x.com: unreadable BTCScore"],
    );
  });

  test("keeps the later of two rows for one email, and says so", () => {
    const parsed = parseHistorySheet(sheet(["a@x.com", null, null, 1], ["A@x.com", null, null, 2]));
    assert.ok(parsed.ok);
    assert.deepEqual(
      parsed.rows.map((r) => r.btcScore),
      [2],
    );
    assert.deepEqual(parsed.problems, [{ row: 3, message: "a@x.com is also on row 2; this later row is the one kept" }]);
  });

  test("refuses a sheet with no email column, or nothing in it", () => {
    assert.deepEqual(parseHistorySheet({ rows: [["name"], ["Pat"]], date1904: false }), {
      ok: false,
      error: "no_email_column",
    });
    assert.deepEqual(parseHistorySheet({ rows: [[], [null]], date1904: false }), { ok: false, error: "empty" });
  });
});
