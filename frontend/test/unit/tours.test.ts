/**
 * Page tours, without a database: which pages a pattern covers, how a step
 * finds its element again, and who may write a page's tour.
 *
 * The regex is what the database matches a page against, so the cases here
 * run it through JavaScript's engine, which reads these simple patterns the
 * same way Postgres does. `canEditTour` is pinned one page per area: moving an
 * entry between sections, or giving it a gear, changes who administers its
 * tour, and that should be done on purpose.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { canEditTour } from "@/lib/nav";
import { isTourPattern, normalizePath, patternRegex, patternSpecificity, suggestPattern } from "@/lib/tours/pattern";
import { cssString, nameOf, resolveTarget, type TargetNode, type TargetRoot } from "@/lib/tours/target";
import { PERSONAS, type Persona } from "../support/access";

describe("patterns", () => {
  test("accepts literal and [name] segments only", () => {
    for (const ok of ["/", "/events", "/events/[id]", "/me/check-pc", "/labs/[slug]/guide.v2"]) {
      assert.ok(isTourPattern(ok), ok);
    }
    for (const bad of ["", "events", "/events/", "//events", "/events/*", "/events/[1d]", "/a b", "/(app)/x"]) {
      assert.ok(!isTourPattern(bad), bad);
    }
  });

  test("a [name] segment stands for exactly one segment", () => {
    const re = new RegExp(patternRegex("/events/[id]"));
    assert.ok(re.test("/events/3f2c"));
    assert.ok(!re.test("/events"));
    assert.ok(!re.test("/events/3f2c/runs"));
    assert.ok(!re.test("/xevents/3f2c"));
  });

  test("dots are literal", () => {
    const re = new RegExp(patternRegex("/labs/guide.v2"));
    assert.ok(re.test("/labs/guide.v2"));
    assert.ok(!re.test("/labs/guideXv2"));
  });

  test("the root pattern matches the root alone", () => {
    const re = new RegExp(patternRegex("/"));
    assert.ok(re.test("/"));
    assert.ok(!re.test("/events"));
  });

  test("written-out segments make a pattern more specific", () => {
    assert.ok(patternSpecificity("/events/new") > patternSpecificity("/events/[id]"));
    assert.equal(patternSpecificity("/[a]/[b]"), 0);
  });

  test("suggests [id] for segments that are records, not pages", () => {
    assert.equal(suggestPattern("/events/3f2c1b8e-1d2a-4c3b-9a8f-0e1d2c3b4a59"), "/events/[id]");
    assert.equal(suggestPattern("/cohorts/42/attendees"), "/cohorts/[id]/attendees");
    assert.equal(suggestPattern("/labs/cm3k9z0qe0000abcd1234efgh"), "/labs/[id]");
    assert.equal(suggestPattern("/scheduler-settings/checklist"), "/scheduler-settings/checklist");
    assert.equal(suggestPattern("/"), "/");
  });

  test("a path is cleaned of its query, hash and trailing slash", () => {
    assert.equal(normalizePath("/events/?tab=runs"), "/events");
    assert.equal(normalizePath("/events#top"), "/events");
    assert.equal(normalizePath("/"), "/");
  });
});

/** A tree of fake elements, matched by a few hand-written selectors. */
type Fake = TargetNode & { attrs: Record<string, string> };

function el(tagName: string, attrs: Record<string, string> = {}, text = ""): Fake {
  return { tagName: tagName.toUpperCase(), attrs, textContent: text, getAttribute: (n) => attrs[n] ?? null };
}

function rootOf(nodes: Fake[], paths: Record<string, Fake[]> = {}): TargetRoot {
  return {
    querySelectorAll(selector) {
      if (selector in paths) return paths[selector]!;
      const attr = /^\[([a-z-]+)="(.*)"\]$/.exec(selector);
      if (attr) return nodes.filter((n) => n.attrs[attr[1]!] === attr[2]);
      // A role's selector list: match the explicit role or the bare tag names in it.
      const parts = selector.split(", ");
      return nodes.filter((n) =>
        parts.some((p) => {
          const role = /^\[role="(.*)"\]$/.exec(p);
          return role ? n.attrs.role === role[1] : p === n.tagName.toLowerCase();
        }),
      );
    },
  };
}

describe("finding a step's element", () => {
  const save = el("button", {}, "  Save\n changes ");
  const cancel = el("button", { "aria-label": "Cancel the edit" }, "×");
  const tab = el("div", { role: "tab", "data-tour": "runs-tab" }, "Runs");
  const field = el("input", { id: "event-name" });
  const root = rootOf([save, cancel, tab, field], { "main > section:nth-of-type(2)": [tab] });

  test("data-tour first, then id", () => {
    assert.equal(resolveTarget({ tour: "runs-tab", id: "event-name", label: "" }, root), tab);
    assert.equal(resolveTarget({ tour: "gone", id: "event-name", label: "" }, root), field);
  });

  test("then role and accessible name, collapsed, preferring aria-label to text", () => {
    assert.equal(nameOf(save), "Save changes");
    assert.equal(resolveTarget({ role: "button", name: "Save changes", label: "" }, root), save);
    assert.equal(resolveTarget({ role: "button", name: "Cancel the edit", label: "" }, root), cancel);
    assert.equal(resolveTarget({ role: "tab", name: "Runs", label: "" }, root), tab);
  });

  test("then the structural path", () => {
    assert.equal(resolveTarget({ tour: "gone", path: "main > section:nth-of-type(2)", label: "" }, root), tab);
  });

  test("a way that matches two elements is passed over", () => {
    const twins = rootOf([el("button", {}, "Add"), el("button", {}, "Add"), field]);
    assert.equal(resolveTarget({ role: "button", name: "Add", label: "" }, twins), null);
    assert.equal(resolveTarget({ role: "button", name: "Add", id: "event-name", label: "" }, twins), field);
  });

  test("nothing found is null, and a selector the browser rejects is not an error", () => {
    const throwing: TargetRoot = {
      querySelectorAll() {
        throw new Error("SyntaxError");
      },
    };
    assert.equal(resolveTarget({ path: "div:nth-of-type(", label: "" }, throwing), null);
    assert.equal(resolveTarget({ label: "nothing" }, root), null);
  });

  test("attribute values are quoted safely", () => {
    assert.equal(cssString(`a"b\\c`), `"a\\"b\\\\c"`);
  });
});

describe("who may write a page's tour", () => {
  const CASES: [path: string, editors: Persona[]][] = [
    ["/events", ["eventAdmin", "bothAdmins", "platform"]],
    ["/events/[id]", ["eventAdmin", "bothAdmins", "platform"]],
    ["/settings/domains", ["eventAdmin", "bothAdmins", "platform"]],
    ["/scheduler", ["trainingAdmin", "bothAdmins", "platform"]],
    ["/scheduler-settings", ["trainingAdmin", "bothAdmins", "platform"]],
    ["/recordings", ["trainingAdmin", "bothAdmins", "platform"]],
    ["/evals", ["assessmentsAdmin", "platform"]],
    ["/diagnostic", ["assessmentsAdmin", "platform"]],
    // Mimir sits under Assessments, but its gear is Mimir Settings, a training administrator's.
    ["/mimir", ["trainingAdmin", "bothAdmins", "platform"]],
    ["/mimir-settings", ["trainingAdmin", "bothAdmins", "platform"]],
    ["/me", ["platform"]],
    ["/welcome", ["platform"]],
    ["/users", ["platform"]],
    ["/not-in-the-sidebar", ["platform"]],
  ];

  for (const [path, editors] of CASES) {
    test(path, () => {
      const allowed = (Object.keys(PERSONAS) as Persona[]).filter((p) => canEditTour(PERSONAS[p], path));
      assert.deepEqual(allowed.sort(), [...editors].sort());
    });
  }
});
