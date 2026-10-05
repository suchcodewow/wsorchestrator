/**
 * The Canary Wire, from an uploaded pull to what a manager pastes into Slack.
 *
 * Each case is a bug the canary-wire-reports tool actually shipped, or the
 * rule that stopped it: a shared module read as another role's copy, a bare
 * date shifted a day by UTC, a month opened because it had content rather
 * than activity, a link built through a series the rep isn't enrolled in.
 * The month view was also checked against the tool's own `month_view` on a
 * live pull (all seven months, every field, no differences) when it was
 * ported; these keep it there.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { EXEMPT_DATE } from "@/db/schema";
import { MODULE_URL_TEMPLATE, SERIES_LINKS } from "@/lib/canary-wire/config";
import { accountability, formatExemptionText, parseExemptionText, parseMonth } from "@/lib/canary-wire/exemptions";
import { monthAfterDay, monthKey, monthRange, toPacific } from "@/lib/canary-wire/months";
import { dayOnly, moduleUrl, slackReport, stateClass, when } from "@/lib/canary-wire/report";
import { parseSnapshot, type CanaryWireSnapshot } from "@/lib/canary-wire/snapshot";
import { defaultMonth, monthCsv, monthView, offeredMonths, type Cell } from "@/lib/canary-wire/view";

const AE = "AE and Supporting Orgs";
const SE = "SE";

/** Ada manages Bo and Cy (AE) and Di (SE); Eve (SE) reports to Fay, who isn't in any group. */
function pull(): CanaryWireSnapshot {
  const learner = (email: string, name: string, role: string, manager: string, manager_email: string, state = "ACTIVE") => ({
    email, name, role, manager, manager_email, title: "Account Executive", state,
  });
  const mod = (module_id: string, label: string, month: string, edition: string, series_id: string, type = "UPDATE") => ({
    module_id, name: `${month} - ${label}`, label, month, edition, series_id, type,
  });
  return {
    fetched_at: "2026-10-01T16:00:00+00:00",
    generated_at: "",
    learners: [
      learner("ada@harness.io", "Ada", AE, "", ""),
      learner("bo@harness.io", "Bo", AE, "Ada", "ada@harness.io"),
      learner("cy@harness.io", "Cy", AE, "Ada", "ada@harness.io", "ADDED"),
      learner("di@harness.io", "Di", SE, "Ada", "ada@harness.io"),
      learner("eve@harness.io", "Eve", SE, "Fay", "fay@harness.io"),
    ],
    modules: [
      // One module id under both editions: Flex Pricing is shared, not copied.
      mod("m-flex", "Flex Pricing", "September 2026", AE, "s-ae"),
      mod("m-flex", "Flex Pricing", "September 2026", SE, "s-se"),
      mod("m-obj", "Objections", "September 2026", AE, "s-ae"),
      mod("m-demo", "Demo Day", "September 2026", SE, "s-se", "ASSESSMENT"),
      mod("m-oct", "Pricing 2", "October 2026", AE, "s-ae"),
    ],
    progress: {
      "ada@harness.io": { "m-flex": { state: "Completed", on: "2026-09-10", at: "2026-09-10T18:30:00Z" } },
      "bo@harness.io": {
        "m-flex": { state: "Completed", on: "2026-09-28", at: "2026-09-28T18:29:00Z" },
        "m-obj": { state: "In Progress", on: "2026-09-29", at: "2026-09-29T01:00:00Z" },
        // Another edition's module, finished anyway.
        "m-demo": { state: "Completed", on: "2026-09-20", at: "2026-09-20T12:00:00Z" },
      },
      "di@harness.io": { "m-flex": { state: "Completed", on: "2026-10-01", at: "" } },
      "eve@harness.io": { "m-demo": { state: "Completed", on: "2026-09-15", at: "2026-09-15T17:00:00Z" } },
      // October has content but nobody has touched it.
      "cy@harness.io": { "m-oct": { state: "Not Started", on: "", at: "" } },
    },
    notes: [],
  };
}

const everyoneAccountable = accountability(new Map(), new Map(pull().learners.map((l) => [l.email, EXEMPT_DATE])));

describe("months", () => {
  test("a bootcamp counts from the month after, across a year end", () => {
    assert.equal(monthAfterDay("2026-08-12"), "September 2026");
    assert.equal(monthAfterDay("2026-12-31"), "January 2027");
    assert.equal(monthAfterDay("not a day"), null);
  });

  test("months order by year then month, and junk orders first", () => {
    assert.ok(monthKey("January 2027") > monthKey("December 2026"));
    assert.equal(monthKey("Smarch 2026"), 0);
    assert.deepEqual(monthRange("November 2026", "February 2027"), ["November 2026", "December 2026", "January 2027", "February 2027"]);
  });

  test("stamps are Pacific, named PDT or PST from the date itself", () => {
    assert.equal(toPacific("2026-09-28T18:29:00Z"), "Sep 28, 2026 at 11:29 AM PDT");
    assert.equal(toPacific("2026-12-01T18:29:00Z"), "Dec 1, 2026 at 10:29 AM PST");
    assert.equal(toPacific("2026-10-05T16:11:11.005199+00:00"), "Oct 5, 2026 at 9:11 AM PDT");
  });

  test("a bare date is no moment, rather than the evening before", () => {
    assert.equal(toPacific("2026-10-01"), "");
    assert.equal(toPacific(""), "");
  });
});

describe("accountability", () => {
  const overrides = new Map<string, string | null>([
    ["never@harness.io", null],
    ["later@harness.io", "2026-11"],
    // A hand-set line beats bootcamp history either way.
    ["attended@harness.io", null],
  ]);
  const btc = new Map([
    ["attended@harness.io", "2026-08-12"],
    ["aug@harness.io", "2026-08-12"],
    ["veteran@harness.io", EXEMPT_DATE],
  ]);
  const who = accountability(overrides, btc);

  test("a BTC date counts from the month after it, never the month of", () => {
    assert.equal(who("aug@harness.io", "August 2026").exempt, true);
    assert.deepEqual(who("AUG@harness.io", "September 2026"), { exempt: false, from: "September 2026", source: "bootcamp" });
  });

  test("BTC marked exempt counts in every month", () => {
    assert.deepEqual(who("veteran@harness.io", "June 2026"), { exempt: false, from: "", source: "bootcamp" });
  });

  test("no bootcamp on record is pre-bootcamp in every month", () => {
    assert.deepEqual(who("new@harness.io", "June 2027"), { exempt: true, from: "", source: "no_bootcamp" });
  });

  test("a hand-set exemption overrides history, and a month ends it", () => {
    assert.equal(who("attended@harness.io", "December 2026").exempt, true);
    assert.equal(who("never@harness.io", "June 2027").exempt, true);
    assert.equal(who("later@harness.io", "October 2026").exempt, true);
    assert.deepEqual(who("later@harness.io", "November 2026"), { exempt: false, from: "November 2026", source: "manual" });
  });
});

describe("parseExemptionText", () => {
  test("takes a messy spreadsheet paste, skipping what isn't an email", () => {
    const text = [
      "# a comment",
      '"Dana Rep" <Dana@Harness.io>\tAugust 2026',
      "",
      "lee@harness.io, Aug 2027",
      "kim@harness.io; 2026-11",
      "pat@harness.io, sometime soon",
      "no email on this line",
      "lee@harness.io",
    ].join("\n");
    assert.deepEqual(parseExemptionText(text), [
      { email: "dana@harness.io", accountableFrom: "2026-08" },
      // The last line for an email wins.
      { email: "lee@harness.io", accountableFrom: null },
      { email: "kim@harness.io", accountableFrom: "2026-11" },
      // A month that can't be read is "not yet", the safer reading.
      { email: "pat@harness.io", accountableFrom: null },
    ]);
  });

  test("months in the forms people type", () => {
    assert.equal(parseMonth(", August 2026"), "2026-08");
    assert.equal(parseMonth("sept 2026"), "2026-09");
    assert.equal(parseMonth("2026/3"), "2026-03");
    assert.equal(parseMonth("2026-13"), null);
    assert.equal(parseMonth("Ma 2026"), null);
  });

  test("the dialog's text reads back as the same list", () => {
    const rows = [
      { email: "dana@harness.io", accountableFrom: "2026-08" },
      { email: "lee@harness.io", accountableFrom: null },
    ];
    assert.equal(formatExemptionText(rows), "dana@harness.io, August 2026\nlee@harness.io");
    assert.deepEqual(parseExemptionText(formatExemptionText(rows)), rows);
  });
});

describe("parseSnapshot", () => {
  test("keeps only what the page uses: no departed staff, departments or Mindtickle ids", () => {
    const raw = { ...pull(), excluded: [{ email: "gone@harness.io" }], notes: ["kept", "12 departed staff still sitting in groups"] };
    raw.learners[0] = { ...raw.learners[0]!, department: "Sales", user_id: "123" } as never;
    const out = parseSnapshot(JSON.stringify(raw));
    assert.ok(out.ok);
    assert.equal("excluded" in out.snapshot, false);
    assert.equal("department" in out.snapshot.learners[0]!, false);
    assert.equal("user_id" in out.snapshot.learners[0]!, false);
    // A note the tool has retired is dropped from an old pull on the way in.
    assert.deepEqual(out.snapshot.notes, ["kept"]);
  });

  test("says what is wrong with a file that isn't a pull", () => {
    assert.deepEqual(parseSnapshot("{not json"), { ok: false, error: "not_json" });
    const missing = parseSnapshot(JSON.stringify({ ...pull(), learners: undefined }));
    assert.equal(missing.ok, false);
    assert.match(!missing.ok ? (missing.detail ?? "") : "", /^learners/);
    assert.equal(parseSnapshot(JSON.stringify({ ...pull(), fetched_at: "yesterday-ish" })).ok, false);
  });
});

describe("monthView", () => {
  const view = monthView(pull(), "September 2026", everyoneAccountable);
  const rep = (email: string) => view.teams.flatMap((t) => t.directs).find((d) => d.email === email)!;

  test("a module shared by two editions is one column, and nobody's off-role work", () => {
    assert.deepEqual(view.labels, ["Demo Day", "Flex Pricing", "Objections"]);
    assert.equal(rep("di@harness.io").cells["Flex Pricing"]!.accountable, true);
    assert.equal(rep("di@harness.io").cells["Flex Pricing"]!.seriesId, "s-se");
    assert.equal(rep("bo@harness.io").cells["Flex Pricing"]!.seriesId, "s-ae");
    assert.equal(rep("di@harness.io").offRole, 0);
  });

  test("another edition's module is shown, not counted", () => {
    const bo = rep("bo@harness.io");
    assert.deepEqual(
      { accountable: bo.cells["Demo Day"]!.accountable, exempt: bo.cells["Demo Day"]!.exempt, edition: bo.cells["Demo Day"]!.edition },
      { accountable: false, exempt: false, edition: SE },
    );
    assert.deepEqual([bo.assigned, bo.completed, bo.pct, bo.offRole], [2, 1, 50, 1]);
  });

  test("pre-bootcamp: unstarted work leaves the lineup, finished work stays uncounted", () => {
    const pre = accountability(new Map([["bo@harness.io", null]]), new Map(pull().learners.map((l) => [l.email, EXEMPT_DATE])));
    const v = monthView(pull(), "September 2026", pre);
    const bo = v.teams.flatMap((t) => t.directs).find((d) => d.email === "bo@harness.io")!;
    assert.deepEqual([bo.exempt, bo.assigned, bo.pct], [true, 0, null]);
    assert.deepEqual(
      { accountable: bo.cells["Flex Pricing"]!.accountable, exempt: bo.cells["Flex Pricing"]!.exempt },
      { accountable: false, exempt: true },
    );
    // Pre-bootcamp, not off-role, so it doesn't add to the off-role count.
    assert.equal(bo.offRole, 1);
    const ada = v.teams.find((t) => t.manager === "Ada")!;
    assert.deepEqual([ada.learners, ada.exempt], [2, 1]);
  });

  test("a manager is anyone named as someone's manager; everyone else is an IC", () => {
    assert.equal(rep("ada@harness.io").ic, false);
    assert.equal(rep("bo@harness.io").ic, true);
    // Fay manages Eve but isn't in a Canary Wire group; Eve is still an IC.
    assert.equal(rep("eve@harness.io").ic, true);
  });

  test("teams best first, directs best first then by name, and a never-activated rep is labelled", () => {
    assert.deepEqual(view.teams.map((t) => t.manager), ["(no manager on record)", "Fay", "Ada"]);
    assert.deepEqual(view.teams.find((t) => t.manager === "Ada")!.directs.map((d) => d.name), ["Bo", "Di", "Cy"]);
    assert.equal(rep("cy@harness.io").notActivated, true);
    assert.equal(view.totals!.notActivated, 1);
  });

  test("a team that owes nothing sorts last rather than as 0%", () => {
    const v = monthView(pull(), "September 2026", accountability(new Map([["ada@harness.io", null]]), new Map()));
    assert.equal(v.teams.at(-1)!.pct, null);
  });

  test("the last completion is the freshness floor, with a full moment only", () => {
    assert.equal(view.lastActivity.atPt, "Sep 28, 2026 at 11:29 AM PDT");
    assert.equal(view.lastActivity.module, "Flex Pricing");
  });

  test("opens on the newest month somebody worked in, not the newest with content", () => {
    assert.equal(defaultMonth(pull()), "September 2026");
    assert.ok(offeredMonths(pull()).includes("October 2026"));
  });

  test("the CSV says why a square isn't counted, and quotes what needs it", () => {
    const csv = monthCsv(view).split("\r\n");
    assert.equal(csv[0], "Name,Email,Role,Manager,Manager Email,Demo Day,Flex Pricing,Objections,Modules Assigned,Modules Completed,Completion %,Account");
    const bo = csv.find((l) => l.startsWith("Bo,"))!;
    assert.match(bo, /Completed \(off-role\),Completed,In Progress,2,1,50\.0,Active$/);
    assert.match(csv.find((l) => l.startsWith("Cy,"))!, /Never activated Mindtickle$/);
    const quoted = monthView({ ...pull(), learners: pull().learners.map((l) => ({ ...l, name: `${l.name}, "Jr"` })) }, "September 2026", everyoneAccountable);
    assert.ok(monthCsv(quoted).includes('"Bo, ""Jr"""'));
  });
});

const cell = (over: Partial<Cell>): Cell => ({
  state: "Completed", on: "2026-09-28", atPt: "Sep 28, 2026 at 11:29 AM PDT", moduleId: "m 1", seriesId: "s-ae",
  moduleType: "UPDATE", accountable: true, exempt: false, also: [], ...over,
});

describe("squares", () => {
  test("colour from the state's wording", () => {
    assert.deepEqual(["Completed", "In Progress", "Not Started", "timedout"].map(stateClass), ["completed", "progress", "notstarted", "blank"]);
  });

  test("unfinished work's stamp is the last activity, not a finish time", () => {
    assert.equal(when(cell({})), " Sep 28, 2026 at 11:29 AM PDT");
    assert.equal(when(cell({ state: "In Progress" })), " — last activity Sep 28, 2026 at 11:29 AM PDT");
    assert.equal(when(cell({ atPt: "" })), " on 2026-09-28");
  });

  test("the Slack day is cut from the stamp, and a bare date isn't shifted by UTC", () => {
    assert.equal(dayOnly(cell({})), "Sep 28, 2026");
    assert.equal(dayOnly(cell({ atPt: "", on: "2026-10-01" })), "Oct 1, 2026");
  });

  test("a link goes through the rep's own series, and only where it is true", () => {
    assert.equal(moduleUrl(cell({}), MODULE_URL_TEMPLATE), "https://flightdeck.harness.io/new/ui/learner/update/m%201/consume?series=s-ae");
    assert.equal(moduleUrl(cell({ moduleType: "ASSESSMENT" }), MODULE_URL_TEMPLATE).includes("/learner/assessment/"), true);
    // Pre-bootcamp keeps its link: the module is in their lineup.
    assert.notEqual(moduleUrl(cell({ accountable: false, exempt: true }), MODULE_URL_TEMPLATE), "");
    // Off-role: a series they aren't enrolled in.
    assert.equal(moduleUrl(cell({ accountable: false }), MODULE_URL_TEMPLATE), "");
    assert.equal(moduleUrl(cell({ moduleType: "../x" }), MODULE_URL_TEMPLATE), "");
    assert.equal(moduleUrl(cell({ seriesId: "" }), MODULE_URL_TEMPLATE), "");
    assert.equal(moduleUrl(cell({}), ""), "");
  });
});

describe("slackReport", () => {
  const view = monthView(pull(), "September 2026", everyoneAccountable);
  const ada = view.teams.find((t) => t.manager === "Ada")!;

  test("one edition: the title is its series link, and only owed modules are listed", () => {
    const aeOnly = ada.directs.filter((d) => d.role === AE);
    const { text, html } = slackReport(ada, aeOnly, view.labels, view.month, SERIES_LINKS, MODULE_URL_TEMPLATE);
    const lines = text.split("\n");
    assert.equal(lines[0], "Canary Wire — September 2026 — Ada (2 of 3 shown)");
    assert.equal(lines[1], SERIES_LINKS[0]!.url);
    assert.ok(html.startsWith(`<div><b><a href="${SERIES_LINKS[0]!.url}">Canary Wire — September 2026</a> — Ada (2 of 3 shown)</b></div>`));
    // Bo's off-role Demo Day is real, but not his to chase.
    assert.equal(text.includes("Demo Day"), false);
    assert.ok(lines.includes("  • \u{1F7E2} Flex Pricing — Completed (Sep 28, 2026)"));
    assert.ok(lines.includes("  • \u{1F7E1} Objections — In Progress"));
    assert.ok(lines.includes("    https://flightdeck.harness.io/new/ui/learner/update/m-flex/consume?series=s-ae"));
    assert.equal(lines.at(-1), "Team total: 1/4 (25.0%)");
  });

  test("two editions: a plain title, with both series named under it", () => {
    const { text, html } = slackReport(ada, ada.directs, view.labels, view.month, SERIES_LINKS, MODULE_URL_TEMPLATE);
    const lines = text.split("\n");
    assert.equal(lines[0], "Canary Wire — September 2026 — Ada");
    assert.equal(lines[1], `AE series: ${SERIES_LINKS[0]!.url}`);
    assert.equal(lines[2], `SE series: ${SERIES_LINKS[1]!.url}`);
    assert.ok(html.startsWith("<div><b>Canary Wire — September 2026 — Ada</b></div>"));
    // Di's completion has a day but no moment, and still gets its day.
    assert.ok(lines.includes("  • \u{1F7E2} Flex Pricing — Completed (Oct 1, 2026)"));
  });

  test("names and labels are escaped in the rich flavour", () => {
    const team = { manager: "R&D <Lab>", directs: [] };
    const { html } = slackReport(team, [], [], "September 2026", [], "");
    assert.ok(html.includes("R&amp;D &lt;Lab&gt;"));
    assert.ok(html.endsWith("<div>Team total: nothing owed this month</div>"));
  });
});
