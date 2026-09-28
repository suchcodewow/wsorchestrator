/**
 * Who may do what, checked for every combination of roles a person can hold.
 *
 * `POLICY` below is the specification, written out a second time on purpose
 * rather than derived from `roles.ts`: a test that computes its expectations
 * with the code under test agrees with any change to it. Moving a permission
 * from one role to another therefore means editing both, which is the point —
 * it is a decision about who can reach backups or the database console, and it
 * should not happen as a side effect.
 *
 * The rules it encodes:
 * - Event roles are ranked none < contributor < operator < manager <
 *   administrator, and each includes the ones below it.
 * - Scheduler roles are ranked viewer < administrator; no scheduler role is no
 *   scheduler access.
 * - A platform administrator is an administrator in every area whatever their
 *   stored roles say, and alone runs backups, the database console and
 *   sign-in domains, and grants platform administration.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { EVENT_ROLES, SCHEDULER_ROLES, type EventRole, type SchedulerRole } from "@/db/schema";
import * as roles from "@/lib/roles";
import type { Access } from "@/lib/roles";
import { EVERY_ACCESS, PERSONAS, describeAccess } from "../support/access";

const EVENT_RANK: Record<EventRole, number> = {
  none: 0,
  contributor: 1,
  operator: 2,
  manager: 3,
  administrator: 4,
};

const SCHEDULER_RANK: Record<SchedulerRole, number> = { viewer: 1, administrator: 2 };

const event = (min: EventRole) => (a: Access) =>
  a.platform || EVENT_RANK[a.event] >= EVENT_RANK[min];

const scheduler = (min: SchedulerRole) => (a: Access) =>
  a.platform || (a.scheduler !== null && SCHEDULER_RANK[a.scheduler] >= SCHEDULER_RANK[min]);

const platformOnly = (a: Access) => a.platform;

type Check = (a: Access) => boolean;

const POLICY: Record<string, { actual: Check; expected: Check }> = {
  canUseEvents: { actual: roles.canUseEvents, expected: event("contributor") },
  canContributeComponents: { actual: roles.canContributeComponents, expected: event("contributor") },
  canCreateEvents: { actual: roles.canCreateEvents, expected: event("operator") },
  canPublishComponents: { actual: roles.canPublishComponents, expected: event("manager") },
  canSeeAllEvents: { actual: roles.canSeeAllEvents, expected: event("manager") },
  canManageAnyEvent: { actual: roles.canManageAnyEvent, expected: event("manager") },
  canManageLabGuides: { actual: roles.canManageLabGuides, expected: event("manager") },
  canManageSettings: { actual: roles.canManageSettings, expected: event("administrator") },
  canAuditProjects: { actual: roles.canAuditProjects, expected: event("administrator") },

  canUseScheduler: { actual: roles.canUseScheduler, expected: scheduler("viewer") },
  canManageSchedulerSettings: {
    actual: roles.canManageSchedulerSettings,
    expected: scheduler("administrator"),
  },

  canRunSql: { actual: roles.canRunSql, expected: platformOnly },
  canManageBackups: { actual: roles.canManageBackups, expected: platformOnly },
  canManageSignInDomains: { actual: roles.canManageSignInDomains, expected: platformOnly },

  "canManageRoles(event)": {
    actual: (a) => roles.canManageRoles(a, "event"),
    expected: event("administrator"),
  },
  "canManageRoles(scheduler)": {
    actual: (a) => roles.canManageRoles(a, "scheduler"),
    expected: scheduler("administrator"),
  },
  "canManageRoles(platform)": {
    actual: (a) => roles.canManageRoles(a, "platform"),
    expected: platformOnly,
  },
  canManageUsers: {
    actual: roles.canManageUsers,
    expected: (a) => event("administrator")(a) || scheduler("administrator")(a),
  },
  canDeleteUsers: { actual: roles.canDeleteUsers, expected: platformOnly },
};

test("the combinations cover every role", () => {
  // 5 event × (none + 2 scheduler) × platform on/off.
  assert.equal(EVERY_ACCESS.length, EVENT_ROLES.length * (SCHEDULER_ROLES.length + 1) * 2);
  assert.equal(new Set(EVERY_ACCESS.map(describeAccess)).size, EVERY_ACCESS.length);
});

describe("every permission, for every combination of roles", () => {
  for (const [name, { actual, expected }] of Object.entries(POLICY)) {
    test(name, () => {
      const wrong = EVERY_ACCESS.filter((a) => actual(a) !== expected(a)).map(
        (a) => `${describeAccess(a)}: got ${actual(a)}, want ${expected(a)}`,
      );
      assert.deepEqual(wrong, []);
    });
  }

  test("no exported can* check is missing from the policy", () => {
    // A new permission added to roles.ts without a line above would otherwise go
    // untested, and this is the file that says who holds what.
    const exported = Object.keys(roles).filter((k) => /^can[A-Z]/.test(k) && k !== "canManageRoles");
    const covered = new Set(Object.keys(POLICY));
    assert.deepEqual(exported.filter((k) => !covered.has(k)), []);
  });
});

describe("the areas are independent", () => {
  test("an event administrator has no scheduler access and no platform powers", () => {
    const a = PERSONAS.eventAdmin;
    assert.equal(roles.canUseScheduler(a), false);
    assert.equal(roles.canManageRoles(a, "scheduler"), false);
    assert.equal(roles.canManageRoles(a, "platform"), false);
    assert.equal(roles.canManageBackups(a), false);
    assert.equal(roles.canRunSql(a), false);
    assert.equal(roles.canManageSignInDomains(a), false);
    assert.equal(roles.canDeleteUsers(a), false);
  });

  test("an event administrator keeps the event settings, cloud status and user management", () => {
    const a = PERSONAS.eventAdmin;
    assert.equal(roles.canManageSettings(a), true);
    assert.equal(roles.canAuditProjects(a), true);
    assert.equal(roles.canManageUsers(a), true);
  });

  test("a scheduler administrator has no event access", () => {
    const a = PERSONAS.schedulerAdmin;
    assert.equal(roles.canUseEvents(a), false);
    assert.equal(roles.canManageRoles(a, "event"), false);
    assert.equal(roles.canManageUsers(a), true);
  });

  test("administering both areas does not make someone a platform administrator", () => {
    const a = PERSONAS.bothAdmins;
    assert.equal(roles.canManageRoles(a, "platform"), false);
    assert.equal(roles.canManageBackups(a), false);
  });
});

describe("eventRoleOf / schedulerRoleOf", () => {
  test("return the stored role for everyone but a platform administrator", () => {
    for (const a of EVERY_ACCESS.filter((a) => !a.platform)) {
      assert.equal(roles.eventRoleOf(a), a.event, describeAccess(a));
      assert.equal(roles.schedulerRoleOf(a), a.scheduler, describeAccess(a));
    }
  });

  test("make a platform administrator an administrator in every area, whatever is stored", () => {
    for (const a of EVERY_ACCESS.filter((a) => a.platform)) {
      assert.equal(roles.eventRoleOf(a), "administrator", describeAccess(a));
      assert.equal(roles.schedulerRoleOf(a), "administrator", describeAccess(a));
    }
  });
});

describe("homePath", () => {
  test("is the first area someone can use", () => {
    for (const a of EVERY_ACCESS) {
      const want = event("contributor")(a)
        ? "/events"
        : scheduler("viewer")(a)
          ? "/scheduler"
          : "/welcome";
      assert.equal(roles.homePath(a), want, describeAccess(a));
    }
  });

  test("sends someone with no access anywhere to the welcome page", () => {
    assert.equal(roles.homePath(PERSONAS.nobody), "/welcome");
  });
});

describe("accessBadges", () => {
  test("a platform administrator shows only that, never their stored roles", () => {
    for (const a of EVERY_ACCESS.filter((a) => a.platform)) {
      assert.deepEqual(roles.accessBadges(a), [roles.PLATFORM_ADMIN_LABEL], describeAccess(a));
    }
  });

  test("an ordinary operator, or someone with no access, shows nothing", () => {
    assert.deepEqual(roles.accessBadges(PERSONAS.operator), []);
    assert.deepEqual(roles.accessBadges(PERSONAS.nobody), []);
  });

  test("shows the event role, then the scheduler role", () => {
    assert.deepEqual(
      roles.accessBadges({ event: "manager", scheduler: "viewer", platform: false }),
      ["Event Manager", "Scheduler Viewer"],
    );
    assert.deepEqual(roles.accessBadges(PERSONAS.schedulerAdmin), ["Scheduler Administrator"]);
    assert.deepEqual(roles.accessBadges(PERSONAS.contributor), ["Event Contributor"]);
  });
});

describe("labels", () => {
  test("every event and scheduler role has a label and a description", () => {
    for (const r of EVENT_ROLES) {
      assert.ok(roles.EVENT_ROLE_LABELS[r], r);
      assert.ok(roles.EVENT_ROLE_DESCRIPTIONS[r], r);
    }
    for (const r of SCHEDULER_ROLES) {
      assert.ok(roles.SCHEDULER_ROLE_LABELS[r], r);
      assert.ok(roles.SCHEDULER_ROLE_DESCRIPTIONS[r], r);
    }
  });

  test("the lowest event role reads as no access", () => {
    assert.equal(roles.EVENT_ROLE_LABELS.none, "No event access");
  });
});

describe("asEventRole / asSchedulerRole", () => {
  test("accept exactly the stored values", () => {
    for (const r of EVENT_ROLES) assert.equal(roles.asEventRole(r), r);
    for (const r of SCHEDULER_ROLES) assert.equal(roles.asSchedulerRole(r), r);
  });

  test("reject anything else", () => {
    for (const bad of ["", "Administrator", "admin", "viewer ", null, undefined, 3, {}, ["manager"]]) {
      assert.equal(roles.asEventRole(bad), null, JSON.stringify(bad));
    }
    for (const bad of ["", "none", "Viewer", "manager", null, undefined, 1]) {
      assert.equal(roles.asSchedulerRole(bad), null, JSON.stringify(bad));
    }
  });

  test("an event role is not a scheduler role, even where the names match", () => {
    // "administrator" is both, which is fine; "none" and "manager" are event only.
    assert.equal(roles.asSchedulerRole("none"), null);
    assert.equal(roles.asSchedulerRole("administrator"), "administrator");
  });
});
