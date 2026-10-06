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
import { accountability } from "@/lib/canary-wire/exemptions";
import { managersOf, onlyOrg, orgOf, withHiBob, type Person } from "@/lib/canary-wire/people";
import { scopeFor } from "@/lib/canary-wire/scope";
import type { Access } from "@/lib/roles";
import { firstFullMonth, monthAfterDay, monthKey, monthRange, toPacific } from "@/lib/canary-wire/months";
import { dayOnly, moduleUrl, slackReport, stateClass, when } from "@/lib/canary-wire/report";
import type { CanaryWireSnapshot } from "@/lib/canary-wire/snapshot";
import { columnOrder, defaultMonth, monthCsv, monthView, offeredMonths, type Cell } from "@/lib/canary-wire/view";

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

/** Bootcamp history and HiBob as `accountability` reads them. */
const known = (btc: [string, string][], starts: [string, string][] = [], historyBegins: string | null = null) => ({
  btcDates: new Map(btc),
  startDates: new Map(starts),
  historyBegins,
});

const everyoneAccountable = accountability(known(pull().learners.map((l) => [l.email, EXEMPT_DATE])));

describe("months", () => {
  test("a first full month is the next one, unless the day is the 1st", () => {
    assert.equal(firstFullMonth("2026-10-02"), "November 2026");
    assert.equal(firstFullMonth("2026-10-01"), "October 2026");
    assert.equal(firstFullMonth("2026-12-15"), "January 2027");
  });

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
  const who = accountability(
    known(
      [
        ["aug@harness.io", "2026-08-12"],
        ["veteran@harness.io", EXEMPT_DATE],
        ["first@harness.io", "2025-04-01"],
      ],
      [
        ["old@harness.io", "2019-06-03"],
        ["new@harness.io", "2026-07-01"],
        ["aug@harness.io", "2018-01-01"],
      ],
      "2025-04-01",
    ),
  );

  test("a BTC date counts from the month after it, never the month of", () => {
    assert.equal(who("aug@harness.io", "August 2026", AE).exempt, true);
    assert.deepEqual(who("AUG@harness.io", "September 2026", AE), { exempt: false, from: "September 2026", source: "bootcamp" });
  });

  test("BTC marked exempt counts in every month", () => {
    assert.deepEqual(who("veteran@harness.io", "June 2026", AE), { exempt: false, from: "", source: "bootcamp" });
  });

  test("no record, but at Harness since before bootcamp history begins, counts in every month", () => {
    assert.deepEqual(who("old@harness.io", "June 2026", AE), { exempt: false, from: "", source: "predates_history" });
  });

  test("no record and joined since, or not in HiBob, is pre-bootcamp in every month", () => {
    assert.deepEqual(who("new@harness.io", "June 2027", AE), { exempt: true, from: "", source: "no_bootcamp" });
    assert.deepEqual(who("nobody@harness.io", "June 2027", AE), { exempt: true, from: "", source: "no_bootcamp" });
  });

  test("SDRs never attend bootcamp, so they count from their first full month, record or not", () => {
    const sdr = accountability(known([["oct2@harness.io", "2026-08-12"]], [["oct2@harness.io", "2026-10-02"], ["oct1@harness.io", "2026-10-01"]], "2025-04-01"));
    // Starting October 2nd: not October, from November.
    assert.deepEqual(sdr("oct2@harness.io", "October 2026", "SDR"), { exempt: true, from: "November 2026", source: "first_month" });
    assert.deepEqual(sdr("oct2@harness.io", "November 2026", "SDR"), { exempt: false, from: "November 2026", source: "first_month" });
    // Starting on the 1st, that month is a full one.
    assert.equal(sdr("oct1@harness.io", "October 2026", "SDR").exempt, false);
    // No start date to go on: counted.
    assert.deepEqual(sdr("unknown@harness.io", "June 2026", "SDR"), { exempt: false, from: "", source: "edition" });
  });

  test("with no bootcamp history at all, nobody predates it", () => {
    const empty = accountability(known([], [["old@harness.io", "2019-06-03"]]));
    assert.equal(empty("old@harness.io", "June 2026", AE).exempt, true);
  });
});

describe("completion by learner", () => {
  test("a role's and the totals' rate is people who finished everything, not modules", () => {
    const view = monthView(pull(), "September 2026", everyoneAccountable);
    const ae = view.roles.find((r) => r.role === AE)!;
    // The AE lineup is Flex Pricing and Objections. Ada and Bo finished Flex
    // only and Cy nothing, so none of the three finished everything.
    assert.deepEqual([ae.learners, ae.finished, ae.pct], [3, 0, 0]);
    const se = view.roles.find((r) => r.role === SE)!;
    // Eve finished Demo Day but not Flex; Di finished Flex but not Demo Day.
    assert.deepEqual([se.learners, se.finished], [2, 0]);
    assert.deepEqual([view.totals!.learners, view.totals!.finished, view.totals!.pct], [5, 0, 0]);
  });

  test("someone who owes nothing this month is not a learner in the rate", () => {
    const snap = pull();
    // Give Ada both AE modules done; Bo keeps one of two.
    snap.progress["ada@harness.io"]!["m-obj"] = { state: "Completed", on: "2026-09-11", at: "2026-09-11T10:00:00Z" };
    const view = monthView(snap, "September 2026", accountability(known(snap.learners.filter((l) => l.email !== "cy@harness.io").map((l) => [l.email, EXEMPT_DATE]))));
    const ae = view.roles.find((r) => r.role === AE)!;
    // Cy is pre-bootcamp: out of the rate, counted as exempt.
    assert.deepEqual([ae.learners, ae.finished, ae.pct, ae.exempt], [2, 1, 50, 1]);
    // Ada manages Bo, Cy and Di, so she isn't an IC; Bo is.
    assert.deepEqual([ae.icLearners, ae.icFinished], [1, 0]);
  });
});

describe("withHiBob", () => {
  const people = new Map<string, Person>([
    ["bo@harness.io", { email: "bo@harness.io", fullName: "Bo Hibob", title: "Senior AE", reportsToEmail: "zed@harness.io", reportsToName: "Zed (HiBob)" }],
    ["zed@harness.io", { email: "zed@harness.io", fullName: "Zed Manager", title: "RVP", reportsToEmail: "", reportsToName: "" }],
    ["cy@harness.io", { email: "cy@harness.io", fullName: "Cy Hibob", title: "", reportsToEmail: "gone@harness.io", reportsToName: "Gone Person" }],
  ]);

  test("HiBob's name, title and manager win, and the manager is named as the employee list names them", () => {
    const snap = withHiBob(pull(), people);
    const bo = snap.learners.find((l) => l.email === "bo@harness.io")!;
    assert.deepEqual([bo.name, bo.title, bo.manager, bo.manager_email], ["Bo Hibob", "Senior AE", "Zed Manager", "zed@harness.io"]);
    // A manager HiBob no longer lists keeps the name HiBob gave; a blank title keeps Mindtickle's.
    const cy = snap.learners.find((l) => l.email === "cy@harness.io")!;
    assert.deepEqual([cy.manager, cy.title], ["Gone Person", "Account Executive"]);
    // Someone HiBob doesn't have keeps Mindtickle's details.
    assert.equal(snap.learners.find((l) => l.email === "di@harness.io")!.manager, "Ada");
  });

  test("an IC is someone nobody in HiBob reports to, org-wide", () => {
    // Eve manages nobody in the Canary Wire groups, but HiBob has someone reporting to her.
    const org = managersOf(new Map([...people, ["x@harness.io", { email: "x@harness.io", fullName: "X", title: "", reportsToEmail: "eve@harness.io", reportsToName: "Eve" }]]));
    const view = monthView(pull(), "September 2026", everyoneAccountable, null, org);
    assert.equal(view.teams.flatMap((t) => t.directs).find((r) => r.email === "eve@harness.io")!.ic, false);
  });
});

describe("scope", () => {
  const access = (over: Partial<Access>): Access => ({ event: "none", training: null, evals: null, iris: null, platform: false, judging: false, manager: false, ...over });
  const boss = { access: access({ manager: true }), email: "zed@harness.io" };
  const admin = { access: access({ platform: true }), email: "root@harness.io" };

  test("a manager opens on their own org, and may ask for everyone", () => {
    assert.deepEqual(scopeFor(boss, null), { ok: true, scope: { kind: "org", email: "zed@harness.io" } });
    assert.deepEqual(scopeFor(boss, "everyone"), { ok: true, scope: { kind: "everyone" } });
  });

  test("anyone else sees everyone, and has no org to ask for", () => {
    assert.deepEqual(scopeFor(admin, null), { ok: true, scope: { kind: "everyone" } });
    assert.deepEqual(scopeFor(admin, "org"), { ok: false, error: "not_a_manager" });
    assert.deepEqual(scopeFor(boss, "team"), { ok: false, error: "invalid_scope" });
  });

  test("my org is me and everyone under me, every level down, and nobody beside me", () => {
    const p = (email: string, reportsToEmail: string): Person => ({ email, fullName: email, title: "", reportsToEmail, reportsToName: "" });
    const people = new Map(
      [p("ceo@harness.io", ""), p("zed@harness.io", "ceo@harness.io"), p("bo@harness.io", "zed@harness.io"), p("cy@harness.io", "bo@harness.io"), p("peer@harness.io", "ceo@harness.io")].map((x) => [x.email, x]),
    );
    assert.deepEqual([...orgOf(people, "Zed@Harness.io")].sort(), ["bo@harness.io", "cy@harness.io", "zed@harness.io"]);
    const mine = onlyOrg(pull(), new Set(["bo@harness.io", "cy@harness.io"]));
    assert.deepEqual(mine.learners.map((l) => l.email), ["bo@harness.io", "cy@harness.io"]);
  });
});

describe("columnOrder", () => {
  test("AE's own modules, then the ones AE and SE share, then SE's own, each by name", () => {
    // October 2026, as it was published, plus an AE-only and an SDR-only module.
    const m = (label: string, ...editions: string[]) => editions.map((edition) => ({ label, edition }));
    const october = [
      ...m("Engineering Efficiency Enablement - Certification Exam", SE),
      ...m("SDA Differentiators", AE, SE, "SDR"),
      ...m("Harness Code Repo & AI Code Review", AE, SE, "SDR"),
      ...m("Engineering Efficiency Enablement", SE),
      ...m("Reverse Demo Training Part 1", AE, SE),
      ...m("Pipeline Hygiene", AE),
      ...m("Cold Calling", "SDR"),
    ];
    assert.deepEqual(columnOrder(october), [
      "Pipeline Hygiene",
      "Harness Code Repo & AI Code Review",
      "Reverse Demo Training Part 1",
      "SDA Differentiators",
      "Engineering Efficiency Enablement",
      "Engineering Efficiency Enablement - Certification Exam",
      "Cold Calling",
    ]);
  });
});

describe("monthView", () => {
  const view = monthView(pull(), "September 2026", everyoneAccountable);
  const rep = (email: string) => view.teams.flatMap((t) => t.directs).find((d) => d.email === email)!;

  test("a module shared by two editions is one column, and nobody's off-role work", () => {
    assert.deepEqual(view.labels, ["Objections", "Flex Pricing", "Demo Day"]);
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
    // Bo has no bootcamp on record; everyone else is exempt from it.
    const pre = accountability(known(pull().learners.filter((l) => l.email !== "bo@harness.io").map((l) => [l.email, EXEMPT_DATE])));
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
    // Nobody has a bootcamp on record, so nobody owes anything.
    const v = monthView(pull(), "September 2026", accountability(known([])));
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
    assert.equal(csv[0], "Name,Email,Role,Manager,Manager Email,Objections,Flex Pricing,Demo Day,Modules Assigned,Modules Completed,Completion %,Account");
    const bo = csv.find((l) => l.startsWith("Bo,"))!;
    assert.match(bo, /In Progress,Completed,Completed \(off-role\),2,1,50\.0,Active$/);
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
