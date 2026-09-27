/**
 * The event vocabulary in the Drizzle schema: what may be changed about a run
 * in each state, the per-mode limits, and the constants other code sizes
 * things by.
 *
 * `editabilityOf` is what stops an organizer editing a run the runner is in the
 * middle of applying — a user count changed mid-apply means accounts that
 * Terraform created and nothing records. `EVENT_LIMITS` is the only thing
 * between a challenge and the per-competitor cloud footprint it would take to
 * run it at workshop size. Both are pinned here as a written-out table rather
 * than derived, so moving a status or raising a limit has to be done on
 * purpose.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CLOUDS,
  CLOUD_LABELS,
  COMPONENT_KINDS,
  COMPONENT_SCOPES,
  COMPONENT_SET_STATUSES,
  DAY_SECONDS,
  DEFAULT_TTL_DAYS,
  EVENT_LIMITS,
  EVENT_MODES,
  EXTENSION_SECONDS,
  LAB_IMAGE_LIMITS,
  LAB_IMAGE_MIME_TYPES,
  MAX_TTL_DAYS,
  MAX_USERS,
  RESOURCE_KINDS,
  SCENARIOS,
  THEME_PREFERENCES,
  editabilityOf,
  isScenarioId,
  limitsFor,
  runStatus,
  scenariosForCloud,
  type RunStatus,
} from "@/db/schema";
import * as catalog from "@/lib/scenario-catalog";

const EDITABILITY: Record<RunStatus, "full" | "grow" | "locked"> = {
  scheduled: "full",
  ready: "grow",
  requested: "locked",
  provisioning: "locked",
  applying: "locked",
  destroying: "locked",
  destroy_failed: "locked",
  destroyed: "locked",
  failed: "locked",
};

describe("editabilityOf", () => {
  test("the table above covers every run status", () => {
    assert.deepEqual(Object.keys(EDITABILITY).sort(), [...runStatus.enumValues].sort());
  });

  for (const status of runStatus.enumValues) {
    test(`${status} is ${EDITABILITY[status]}`, () => {
      assert.equal(editabilityOf(status), EDITABILITY[status]);
    });
  }
});

describe("EVENT_LIMITS / limitsFor", () => {
  test("covers every event mode", () => {
    assert.deepEqual(Object.keys(EVENT_LIMITS).sort(), [...EVENT_MODES].sort());
    for (const mode of EVENT_MODES) assert.equal(limitsFor(mode), EVENT_LIMITS[mode]);
  });

  test("a workshop seats up to MAX_USERS on any number of clouds, including none", () => {
    assert.deepEqual(limitsFor("workshop"), {
      maxUsers: MAX_USERS,
      defaultUsers: 10,
      minClouds: 0,
      maxClouds: CLOUDS.length,
    });
    assert.equal(MAX_USERS, 50);
  });

  test("a challenge is small and on exactly one cloud", () => {
    assert.deepEqual(limitsFor("challenge"), { maxUsers: 5, defaultUsers: 1, minClouds: 1, maxClouds: 1 });
  });

  test("every mode's limits are internally consistent", () => {
    for (const mode of EVENT_MODES) {
      const l = limitsFor(mode);
      assert.ok(l.defaultUsers >= 1 && l.defaultUsers <= l.maxUsers, mode);
      assert.ok(l.maxUsers <= MAX_USERS, mode);
      assert.ok(l.minClouds >= 0 && l.minClouds <= l.maxClouds, mode);
      assert.ok(l.maxClouds <= CLOUDS.length, mode);
      for (const n of Object.values(l)) assert.ok(Number.isInteger(n), mode);
    }
  });
});

describe("time constants", () => {
  test("a day is 86400 seconds and an extension is one day", () => {
    assert.equal(DAY_SECONDS, 86_400);
    assert.equal(EXTENSION_SECONDS, DAY_SECONDS);
  });

  test("the default lifetime is within the maximum", () => {
    assert.ok(DEFAULT_TTL_DAYS >= 1);
    assert.ok(DEFAULT_TTL_DAYS <= MAX_TTL_DAYS);
  });
});

describe("enumerations", () => {
  const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

  test("have no duplicates", () => {
    for (const [name, list] of Object.entries({
      CLOUDS,
      EVENT_MODES,
      THEME_PREFERENCES,
      COMPONENT_KINDS,
      COMPONENT_SCOPES,
      COMPONENT_SET_STATUSES,
      RESOURCE_KINDS,
      LAB_IMAGE_MIME_TYPES,
      runStatus: runStatus.enumValues,
    })) {
      assert.ok(unique(list), name);
    }
  });

  test("every cloud has a label", () => {
    assert.deepEqual(Object.keys(CLOUD_LABELS).sort(), [...CLOUDS].sort());
    for (const c of CLOUDS) assert.ok(CLOUD_LABELS[c].length > 0);
  });

  test("theme preferences include system", () => {
    assert.deepEqual([...THEME_PREFERENCES].sort(), ["dark", "light", "system"]);
  });

  test("lab images are raster types only, and capped at 5 MiB", () => {
    for (const t of LAB_IMAGE_MIME_TYPES) assert.match(t, /^image\/(png|jpeg|gif|webp)$/);
    assert.ok(!(LAB_IMAGE_MIME_TYPES as readonly string[]).includes("image/svg+xml"));
    assert.equal(LAB_IMAGE_LIMITS.bytes, 5 * 1024 * 1024);
  });
});

describe("scenario re-exports", () => {
  test("are the catalog's own, not copies", () => {
    assert.equal(SCENARIOS, catalog.SCENARIOS);
    assert.equal(isScenarioId, catalog.isScenarioId);
    assert.equal(scenariosForCloud, catalog.scenariosForCloud);
  });
});
