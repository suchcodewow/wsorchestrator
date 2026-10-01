/**
 * Who may do what, checked for every combination of roles a person can hold.
 *
 * `POLICY` below is the specification, written out a second time on purpose
 * rather than derived from `roles.ts`: a test that computes its expectations
 * with the code under test agrees with any change to it. Moving a permission
 * from one role to another therefore means editing both, which is the point —
 * it is a decision about who can reach backups or sign-in domains, and it
 * should not happen as a side effect.
 *
 * The rules it encodes:
 * - Event roles are ranked none < contributor < operator < manager <
 *   administrator, and each includes the ones below it.
 * - Training roles are ranked viewer < administrator; no training role is no
 *   training access.
 * - eVals roles are ranked the same way, and are independent of the training area's.
 * - A platform administrator is an administrator in every area whatever their
 *   stored roles say, and alone runs backups and sign-in domains, and grants
 *   platform administration.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EVALS_ROLES,
  EVENT_ROLES,
  TRAINING_ROLES,
  type EvalsRole,
  type EventRole,
  type TrainingRole,
} from "@/db/schema";
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

const TRAINING_RANK: Record<TrainingRole, number> = { viewer: 1, administrator: 2 };

const EVALS_RANK: Record<EvalsRole, number> = { viewer: 1, administrator: 2 };

const event = (min: EventRole) => (a: Access) =>
  a.platform || EVENT_RANK[a.event] >= EVENT_RANK[min];

const training = (min: TrainingRole) => (a: Access) =>
  a.platform || (a.training !== null && TRAINING_RANK[a.training] >= TRAINING_RANK[min]);

const evals = (min: EvalsRole) => (a: Access) =>
  a.platform || (a.evals !== null && EVALS_RANK[a.evals] >= EVALS_RANK[min]);

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

  canUseTraining: { actual: roles.canUseTraining, expected: training("viewer") },
  canManageTrainingSettings: {
    actual: roles.canManageTrainingSettings,
    expected: training("administrator"),
  },

  canUseEvals: { actual: roles.canUseEvals, expected: evals("viewer") },
  canManageEvalsSettings: {
    actual: roles.canManageEvalsSettings,
    expected: evals("administrator"),
  },

  canManageBackups: { actual: roles.canManageBackups, expected: platformOnly },
  canManageSignInDomains: { actual: roles.canManageSignInDomains, expected: platformOnly },
  canViewAuditTrail: { actual: roles.canViewAuditTrail, expected: platformOnly },

  "canManageRoles(event)": {
    actual: (a) => roles.canManageRoles(a, "event"),
    expected: event("administrator"),
  },
  "canManageRoles(training)": {
    actual: (a) => roles.canManageRoles(a, "training"),
    expected: training("administrator"),
  },
  "canManageRoles(evals)": {
    actual: (a) => roles.canManageRoles(a, "evals"),
    expected: evals("administrator"),
  },
  "canManageRoles(platform)": {
    actual: (a) => roles.canManageRoles(a, "platform"),
    expected: platformOnly,
  },
  canManageUsers: {
    actual: roles.canManageUsers,
    expected: (a) =>
      event("administrator")(a) || training("administrator")(a) || evals("administrator")(a),
  },
  canDeleteUsers: { actual: roles.canDeleteUsers, expected: platformOnly },
};

test("the combinations cover every role", () => {
  // 5 event × (none + 2 training) × (none + 2 eVals) × platform on/off.
  assert.equal(
    EVERY_ACCESS.length,
    EVENT_ROLES.length * (TRAINING_ROLES.length + 1) * (EVALS_ROLES.length + 1) * 2,
  );
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
  test("an event administrator has no training access and no platform powers", () => {
    const a = PERSONAS.eventAdmin;
    assert.equal(roles.canUseTraining(a), false);
    assert.equal(roles.canManageRoles(a, "training"), false);
    assert.equal(roles.canManageRoles(a, "platform"), false);
    assert.equal(roles.canManageBackups(a), false);
    assert.equal(roles.canManageSignInDomains(a), false);
    assert.equal(roles.canDeleteUsers(a), false);
  });

  test("an event administrator keeps the event settings, cloud status and user management", () => {
    const a = PERSONAS.eventAdmin;
    assert.equal(roles.canManageSettings(a), true);
    assert.equal(roles.canAuditProjects(a), true);
    assert.equal(roles.canManageUsers(a), true);
  });

  test("a training administrator has no event access", () => {
    const a = PERSONAS.trainingAdmin;
    assert.equal(roles.canUseEvents(a), false);
    assert.equal(roles.canManageRoles(a, "event"), false);
    assert.equal(roles.canManageUsers(a), true);
  });

  test("a training administrator has no eVals access, and an eVals administrator no training access", () => {
    assert.equal(roles.canUseEvals(PERSONAS.trainingAdmin), false);
    assert.equal(roles.canManageRoles(PERSONAS.trainingAdmin, "evals"), false);
    assert.equal(roles.canUseTraining(PERSONAS.evalsAdmin), false);
    assert.equal(roles.canManageRoles(PERSONAS.evalsAdmin, "training"), false);
  });

  test("an eVals administrator has no event access", () => {
    const a = PERSONAS.evalsAdmin;
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

describe("eventRoleOf / trainingRoleOf / evalsRoleOf", () => {
  test("return the stored role for everyone but a platform administrator", () => {
    for (const a of EVERY_ACCESS.filter((a) => !a.platform)) {
      assert.equal(roles.eventRoleOf(a), a.event, describeAccess(a));
      assert.equal(roles.trainingRoleOf(a), a.training, describeAccess(a));
      assert.equal(roles.evalsRoleOf(a), a.evals, describeAccess(a));
    }
  });

  test("make a platform administrator an administrator in every area, whatever is stored", () => {
    for (const a of EVERY_ACCESS.filter((a) => a.platform)) {
      assert.equal(roles.eventRoleOf(a), "administrator", describeAccess(a));
      assert.equal(roles.trainingRoleOf(a), "administrator", describeAccess(a));
      assert.equal(roles.evalsRoleOf(a), "administrator", describeAccess(a));
    }
  });
});

describe("homePath", () => {
  test("is the first area someone can use", () => {
    for (const a of EVERY_ACCESS) {
      const want = event("contributor")(a)
        ? "/events"
        : training("viewer")(a)
          ? "/scheduler"
          : evals("viewer")(a)
            ? "/evals"
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

  test("shows the event role, then the training role, then the eVals role", () => {
    assert.deepEqual(
      roles.accessBadges({ event: "manager", training: "viewer", evals: "viewer", platform: false }),
      ["Event Manager", "Training Viewer", "eVals Viewer"],
    );
    assert.deepEqual(roles.accessBadges(PERSONAS.trainingAdmin), ["Training Administrator"]);
    assert.deepEqual(roles.accessBadges(PERSONAS.evalsAdmin), ["eVals Administrator"]);
    assert.deepEqual(roles.accessBadges(PERSONAS.contributor), ["Event Contributor"]);
  });
});

describe("labels", () => {
  test("every event, training and eVals role has a label and a description", () => {
    for (const r of EVENT_ROLES) {
      assert.ok(roles.EVENT_ROLE_LABELS[r], r);
      assert.ok(roles.EVENT_ROLE_DESCRIPTIONS[r], r);
    }
    for (const r of TRAINING_ROLES) {
      assert.ok(roles.TRAINING_ROLE_LABELS[r], r);
      assert.ok(roles.TRAINING_ROLE_DESCRIPTIONS[r], r);
    }
    for (const r of EVALS_ROLES) {
      assert.ok(roles.EVALS_ROLE_LABELS[r], r);
      assert.ok(roles.EVALS_ROLE_DESCRIPTIONS[r], r);
    }
  });

  test("eVals is spelled eVals wherever it is shown", () => {
    const shown = [
      ...Object.values(roles.EVALS_ROLE_LABELS),
      ...Object.values(roles.EVALS_ROLE_DESCRIPTIONS),
      roles.NO_EVALS_ACCESS_LABEL,
    ];
    for (const text of shown) {
      assert.match(text, /eVals/, text);
      assert.doesNotMatch(text, /\b(?!eVals)[eE][vV][aA][lL][sS]\b/, text);
    }
  });

  test("the lowest event role reads as no access", () => {
    assert.equal(roles.EVENT_ROLE_LABELS.none, "No event access");
  });
});

describe("asEventRole / asTrainingRole / asEvalsRole", () => {
  test("accept exactly the stored values", () => {
    for (const r of EVENT_ROLES) assert.equal(roles.asEventRole(r), r);
    for (const r of TRAINING_ROLES) assert.equal(roles.asTrainingRole(r), r);
    for (const r of EVALS_ROLES) assert.equal(roles.asEvalsRole(r), r);
  });

  test("reject anything else", () => {
    for (const bad of ["", "Administrator", "admin", "viewer ", null, undefined, 3, {}, ["manager"]]) {
      assert.equal(roles.asEventRole(bad), null, JSON.stringify(bad));
    }
    for (const bad of ["", "none", "Viewer", "manager", null, undefined, 1]) {
      assert.equal(roles.asTrainingRole(bad), null, JSON.stringify(bad));
      assert.equal(roles.asEvalsRole(bad), null, JSON.stringify(bad));
    }
  });

  test("an event role is not a training role, even where the names match", () => {
    // "administrator" is both, which is fine; "none" and "manager" are event only.
    assert.equal(roles.asTrainingRole("none"), null);
    assert.equal(roles.asTrainingRole("administrator"), "administrator");
  });
});
