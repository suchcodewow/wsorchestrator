/**
 * What each person sees in the sidebar and across the top of event settings.
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
import type { Access } from "@/lib/roles";
import { EVERY_ACCESS, PERSONAS, describeAccess, type Persona } from "../support/access";

/** The sidebar as a person sees it: headings in brackets, then their entries. */
function sidebar(a: Access): string[] {
  return visibleSections(a).flatMap((s) => [
    ...(s.heading ? [`[${s.heading}]`] : []),
    ...s.items.map((i) => i.label),
  ]);
}

const EXPECTED_SIDEBAR: Record<Persona, string[]> = {
  nobody: ["My settings"],
  contributor: ["Event Guides", "Orchestrator", "Contribute", "My settings"],
  operator: ["Event Guides", "Orchestrator", "Contribute", "My settings"],
  manager: ["Event Guides", "Orchestrator", "Contribute", "My settings", "[Management]"],
  eventAdmin: [
    "Event Guides",
    "Orchestrator",
    "Contribute",
    "My settings",
    "[Management]",
    "[Administration]",
    "Manage users",
    "Cloud Status",
    "Event Settings",
  ],
  schedulerViewer: ["Scheduler", "My settings"],
  schedulerAdmin: [
    "Scheduler",
    "My settings",
    "[Administration]",
    "Manage users",
    "Scheduler settings",
  ],
  bothAdmins: [
    "Event Guides",
    "Orchestrator",
    "Contribute",
    "Scheduler",
    "My settings",
    "[Management]",
    "[Administration]",
    "Manage users",
    "Cloud Status",
    "Event Settings",
    "Scheduler settings",
  ],
  platform: [
    "Event Guides",
    "Orchestrator",
    "Contribute",
    "Scheduler",
    "My settings",
    "[Management]",
    "[Administration]",
    "Manage users",
    "Backups",
    "Database",
    "Cloud Status",
    "Event Settings",
    "Scheduler settings",
    "Admin Settings",
  ],
};

describe("sidebar", () => {
  for (const [persona, want] of Object.entries(EXPECTED_SIDEBAR) as [Persona, string[]][]) {
    test(`${persona} (${describeAccess(PERSONAS[persona])})`, () => {
      assert.deepEqual(sidebar(PERSONAS[persona]), want);
    });
  }

  test("My settings is visible to everyone, including someone with no access", () => {
    for (const a of EVERY_ACCESS) {
      assert.ok(sidebar(a).includes("My settings"), describeAccess(a));
    }
  });

  test("a heading never appears with nothing under it", () => {
    for (const a of EVERY_ACCESS) {
      for (const s of visibleSections(a)) {
        assert.ok(s.items.length > 0 || s.control, `${describeAccess(a)}: empty "${s.heading}"`);
      }
    }
  });

  test("the calendar-scope control shows exactly for those who can see all events", () => {
    for (const a of EVERY_ACCESS) {
      const shown = visibleSections(a).some((s) => s.control === "calendar-scope");
      const canSeeAll = a.platform || a.event === "manager" || a.event === "administrator";
      assert.equal(shown, canSeeAll, describeAccess(a));
    }
  });

  test("platform-only pages never show for anyone who is not a platform administrator", () => {
    for (const a of EVERY_ACCESS.filter((a) => !a.platform)) {
      const labels = sidebar(a);
      for (const page of ["Backups", "Database", "Admin Settings"]) {
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
  const orchestrator = NAV_SECTIONS[0]!.items.find((i) => i.label === "Orchestrator")!;
  const scheduler = NAV_SECTIONS[0]!.items.find((i) => i.label === "Scheduler")!;
  const schedulerSettings = NAV_SECTIONS.flatMap((s) => s.items).find(
    (i) => i.label === "Scheduler settings",
  )!;

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
