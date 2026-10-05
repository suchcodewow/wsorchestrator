/**
 * What each person sees in the sidebar, and across the top of event settings
 * and My settings.
 *
 * The sidebar is the only place most people learn a feature exists, so these
 * pin the exact entries per role rather than "at least these": a platform
 * page appearing for an event administrator is as much a bug as one missing
 * for the platform administrator. Visibility is not access — every page checks
 * again on the server, which `test/e2e` covers — but a link that 404s is how a
 * mismatch between the two first shows up.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { NAV_SECTIONS, isNavItemActive, visibleSections, type NavItem } from "@/lib/nav";
import { SITE_SETTINGS_TABS, visibleSettingsTabs } from "@/app/(app)/settings/tabs";
import { MY_SETTINGS_TABS, visibleMySettingsTabs } from "@/app/(app)/me/tabs";
import { canUseEvents } from "@/lib/roles";
import type { Access } from "@/lib/roles";
import { EVERY_ACCESS, PERSONAS, describeAccess, type Persona } from "../support/access";

/** The sidebar as a person sees it: headings in brackets, then their entries. */
function sidebar(a: Access): string[] {
  return visibleSections(a).flatMap((s) => [`[${s.heading}]`, ...s.items.map((i) => i.label)]);
}

const EVENTS_USER = ["[Events]", "Event Guides", "Orchestrator"];
const EVENTS_MANAGER = [...EVENTS_USER];
const EVENTS_ADMIN = [...EVENTS_MANAGER, "Cloud Status", "Event Settings"];
const ACCOUNT = ["[Account]", "My inbox", "My settings"];

const EXPECTED_SIDEBAR: Record<Persona, string[]> = {
  nobody: ACCOUNT,
  contributor: [...EVENTS_USER, ...ACCOUNT],
  operator: [...EVENTS_USER, ...ACCOUNT],
  manager: [...EVENTS_MANAGER, ...ACCOUNT],
  eventAdmin: [...EVENTS_ADMIN, ...ACCOUNT, "[Administration]", "Manage users"],
  trainingViewer: ["[Training]", "Scheduler", "Cohorts", ...ACCOUNT],
  trainingAdmin: [
    "[Training]",
    "Scheduler",
    "Scheduler settings",
    "Cohorts",
    "Cohort Settings",
    ...ACCOUNT,
    "[Administration]",
    "Manage users",
  ],
  evalsViewer: ["[eVals]", "Assessments", "Bootcamp History", ...ACCOUNT],
  evalsAdmin: ["[eVals]", "Assessments", "Bootcamp History", "eVals settings", ...ACCOUNT, "[Administration]", "Manage users"],
  guestJudge: ["[eVals]", "Assessments", ...ACCOUNT],
  bothAdmins: [
    ...EVENTS_ADMIN,
    "[Training]",
    "Scheduler",
    "Scheduler settings",
    "Cohorts",
    "Cohort Settings",
    ...ACCOUNT,
    "[Administration]",
    "Manage users",
  ],
  platform: [
    ...EVENTS_ADMIN,
    "[Training]",
    "Scheduler",
    "Scheduler settings",
    "Cohorts",
    "Cohort Settings",
    "[eVals]",
    "Assessments",
    "Bootcamp History",
    "eVals settings",
    ...ACCOUNT,
    "[Administration]",
    "Manage users",
    "Backups",
    "Admin Settings",
    "Audit Trail",
  ],
};

describe("sidebar", () => {
  for (const [persona, want] of Object.entries(EXPECTED_SIDEBAR) as [Persona, string[]][]) {
    test(`${persona} (${describeAccess(PERSONAS[persona])})`, () => {
      assert.deepEqual(sidebar(PERSONAS[persona]), want);
    });
  }

  test("My settings and My inbox are visible to everyone, including someone with no access", () => {
    for (const a of EVERY_ACCESS) {
      assert.ok(sidebar(a).includes("My settings"), describeAccess(a));
      // A guest judge with no Training role can still own checklist items and be tagged.
      assert.ok(sidebar(a).includes("My inbox"), describeAccess(a));
    }
  });

  test("a heading never appears with nothing under it", () => {
    for (const a of EVERY_ACCESS) {
      for (const s of visibleSections(a)) {
        assert.ok(s.items.length > 0, `${describeAccess(a)}: empty "${s.heading}"`);
      }
    }
  });

  test("platform-only pages never show for anyone who is not a platform administrator", () => {
    for (const a of EVERY_ACCESS.filter((a) => !a.platform)) {
      const labels = sidebar(a);
      for (const page of ["Backups", "Admin Settings", "Audit Trail"]) {
        assert.ok(!labels.includes(page), `${describeAccess(a)} sees ${page}`);
      }
    }
  });

  test("every entry has a distinct href", () => {
    const hrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    assert.equal(new Set(hrefs).size, hrefs.length);
  });
});

describe("isNavItemActive", () => {
  const link = (label: string) =>
    NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.label === label)!;
  const orchestrator = link("Orchestrator");
  const scheduler = link("Scheduler");
  const schedulerSettings = link("Scheduler settings");
  const evals = link("Assessments");
  const evalsSettings = link("eVals settings");

  test("matches the page itself and anything beneath it", () => {
    assert.equal(isNavItemActive("/events", orchestrator), true);
    assert.equal(isNavItemActive("/events/2026-09", orchestrator), true);
  });

  test("matches the extra paths an entry claims", () => {
    // A run's page belongs to the Orchestrator entry.
    assert.equal(isNavItemActive("/runs/abc", orchestrator), true);
  });

  test("does not match a path that merely starts with the same letters", () => {
    const item: NavItem = { ...orchestrator, href: "/event", also: [] };
    assert.equal(isNavItemActive("/events", item), false);
  });

  test("scheduler settings does not also light up the Scheduler entry", () => {
    // Why /scheduler-settings sits beside /scheduler rather than under it.
    assert.equal(isNavItemActive("/scheduler-settings", scheduler), false);
    assert.equal(isNavItemActive("/scheduler-settings", schedulerSettings), true);
  });

  test("eVals settings does not also light up the Assessments entry", () => {
    assert.equal(isNavItemActive("/evals-settings", evals), false);
    assert.equal(isNavItemActive("/evals-settings", evalsSettings), true);
  });
});

describe("event settings tabs", () => {
  const labels = (a: Access) => visibleSettingsTabs(a).map((t) => t.label);

  test("every event administrator gets every tab, platform administrators included", () => {
    for (const a of [PERSONAS.eventAdmin, PERSONAS.platform]) {
      assert.deepEqual(labels(a), ["Org Secrets", "Templates", "GitHub Repos"], describeAccess(a));
    }
  });

  test("sign-in domains is not here: it belongs to Admin Settings", () => {
    // It decides who may sign in at all, which reaches past the event area.
    for (const a of EVERY_ACCESS) assert.ok(!labels(a).includes("Sign-in domains"), describeAccess(a));
  });

  test("every tab lives under /settings", () => {
    for (const t of SITE_SETTINGS_TABS) assert.match(t.href, /^\/settings\//);
  });
});

describe("My settings tabs", () => {
  const labels = (a: Access) => visibleMySettingsTabs(a).map((t) => t.label);
  const EVENT_TABS = ["My Harness tokens", "My org secrets", "My templates"];
  const EVERYONE = ["Check PC", "My API tokens"];

  test("anyone in the event area gets the event tabs, then the rest", () => {
    for (const a of EVERY_ACCESS.filter(canUseEvents)) {
      assert.deepEqual(labels(a), [...EVENT_TABS, ...EVERYONE], describeAccess(a));
    }
  });

  test("anyone else gets only Check PC and their API tokens", () => {
    // A guest judge, a Training or eVals-only user, or someone given nothing.
    for (const a of EVERY_ACCESS.filter((a) => !canUseEvents(a))) {
      assert.deepEqual(labels(a), EVERYONE, describeAccess(a));
    }
  });

  test("a guest judge lands on Check PC", () => {
    assert.equal(visibleMySettingsTabs(PERSONAS.guestJudge)[0]!.href, "/me/check-pc");
  });

  test("every tab lives under /me", () => {
    for (const t of MY_SETTINGS_TABS) assert.match(t.href, /^\/me\//);
  });
});
