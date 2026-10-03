/**
 * Who may change whose roles, against a real database.
 *
 * `setUserRole` is the one place a role changes, and every rule about role
 * assignment lives in it rather than in the page that calls it — so it is
 * checked here for every actor, against every kind of target, for every change
 * in every area. That is about a thousand calls, each of which either lands or
 * is refused for a specific reason, and the reason is checked too: an event
 * administrator refused as `self` when they should have been `forbidden` is a
 * rule applied in the wrong order, which is how the next rule gets skipped.
 *
 * The rules, in the order they apply:
 * 1. `self`            — nobody changes their own roles.
 * 2. `forbidden`       — the actor does not administer that area (event and
 *                        training and eVals administrators, their own area only; the
 *                        platform flag, platform administrators only).
 * 3. `not_found`       — no such user.
 * 4. `platform_target` — only a platform administrator touches another one.
 * 5. `bootstrap`       — SITE_ADMIN_EMAILS addresses keep the platform flag.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { EVALS_ROLES, EVENT_ROLES, TRAINING_ROLES } from "@/db/schema";
import type { Access } from "@/lib/roles";
import { USER_LIST } from "@/lib/list-specs";
import { setUserRole, listSiteUsers, type RoleChange, type SetRoleError } from "@/lib/site-users";
import { PERSONAS, PERSONA_NAMES, describeAccess } from "../support/access";
import { createRun, readRoles, testScope, type TestUser } from "../support/seed";

const scope = testScope("assign");

const BOOTSTRAP_EMAIL = "bootstrap@roles.test";
/** Emails are unique, so each test that needs a second bootstrap address has its own. */
const MORE_BOOTSTRAP = ["bootstrap2@roles.test", "bootstrap3@roles.test"];
const ALL_BOOTSTRAP = [BOOTSTRAP_EMAIL, ...MORE_BOOTSTRAP].join(",");

const CHANGES: RoleChange[] = [
  ...EVENT_ROLES.map((role) => ({ area: "event" as const, role })),
  ...[null, ...TRAINING_ROLES].map((role) => ({ area: "training" as const, role })),
  ...[null, ...EVALS_ROLES].map((role) => ({ area: "evals" as const, role })),
  { area: "platform", value: true },
  { area: "platform", value: false },
];

/** The rules, restated independently of `setUserRole`. */
function expected(
  actor: Access,
  target: Access & { bootstrap: boolean },
  change: RoleChange,
  sameUser: boolean,
): "ok" | SetRoleError {
  if (sameUser) return "self";
  const administers =
    change.area === "platform"
      ? actor.platform
      : change.area === "event"
        ? actor.platform || actor.event === "administrator"
        : change.area === "training"
          ? actor.platform || actor.training === "administrator"
          : actor.platform || actor.evals === "administrator";
  if (!administers) return "forbidden";
  if (target.platform && !actor.platform) return "platform_target";
  if (change.area === "platform" && !change.value && target.bootstrap) return "bootstrap";
  return "ok";
}

function applied(change: RoleChange, before: Access): Access {
  if (change.area === "event") return { ...before, event: change.role };
  if (change.area === "training") return { ...before, training: change.role };
  if (change.area === "evals") return { ...before, evals: change.role };
  return { ...before, platform: change.value };
}

const describeChange = (c: RoleChange) =>
  c.area === "platform" ? `platform=${c.value}` : `${c.area}=${c.role ?? "none"}`;

let savedAdmins: string | undefined;
before(async () => {
  savedAdmins = process.env.SITE_ADMIN_EMAILS;
  process.env.SITE_ADMIN_EMAILS = ALL_BOOTSTRAP;
  await scope.setUp();
});
after(async () => {
  process.env.SITE_ADMIN_EMAILS = savedAdmins;
  await scope.tearDown();
});

describe("every actor, every target, every change", () => {
  type Target = { key: string; access: Access; bootstrap: boolean };
  const TARGETS: Target[] = [
    ...PERSONA_NAMES.map((p) => ({ key: `t_${p}`, access: PERSONAS[p], bootstrap: false })),
    { key: "t_bootstrap", access: PERSONAS.platform, bootstrap: true },
  ];

  for (const actorName of PERSONA_NAMES) {
    test(`as ${actorName} (${describeAccess(PERSONAS[actorName])})`, async () => {
      const actor = await scope.createUser(`a_${actorName}`, PERSONAS[actorName]);
      const wrong: string[] = [];

      for (const t of TARGETS) {
        for (const change of CHANGES) {
          // Reset the target each time, so every change starts from the same roles.
          const target = await scope.createUser(
            t.key,
            t.access,
            t.bootstrap ? BOOTSTRAP_EMAIL : undefined,
          );
          const want = expected(actor.access, { ...t.access, bootstrap: t.bootstrap }, change, false);
          const result = await setUserRole(actor, target.id, change);
          const got = result.ok ? "ok" : result.error;

          const stored = await readRoles(target.id);
          const storedWant = want === "ok" ? applied(change, t.access) : t.access;

          if (got !== want || JSON.stringify(stored) !== JSON.stringify(storedWant)) {
            wrong.push(
              `${t.key} ${describeChange(change)}: got ${got} → ${JSON.stringify(stored)}, ` +
                `want ${want} → ${JSON.stringify(storedWant)}`,
            );
          }
        }
      }
      assert.deepEqual(wrong, []);
    });
  }
});

describe("the edges", () => {
  test("nobody changes their own roles, in any area, platform administrators included", async () => {
    for (const name of PERSONA_NAMES) {
      const me = await scope.createUser(`self_${name}`, PERSONAS[name]);
      for (const change of CHANGES) {
        const result = await setUserRole(me, me.id, change);
        assert.deepEqual(result, { ok: false, error: "self" }, `${name} ${describeChange(change)}`);
      }
      assert.deepEqual(await readRoles(me.id), PERSONAS[name]);
    }
  });

  test("a missing user is not_found to an administrator, forbidden to anyone else", async () => {
    const admin = await scope.createUser("nf_platform", PERSONAS.platform);
    const operator = await scope.createUser("nf_operator", PERSONAS.operator);
    const missing = "wo_test_assign_does_not_exist";

    assert.deepEqual(await setUserRole(admin, missing, { area: "event", role: "manager" }), {
      ok: false,
      error: "not_found",
    });
    // Refused before the lookup, so it says nothing about who exists.
    assert.deepEqual(await setUserRole(operator, missing, { area: "event", role: "manager" }), {
      ok: false,
      error: "forbidden",
    });
  });

  test("the bootstrap check follows SITE_ADMIN_EMAILS as it is now, not as it was", async () => {
    const admin = await scope.createUser("bs_actor", PERSONAS.platform);
    const target = await scope.createUser("bs_target", PERSONAS.platform, "later@roles.test");

    process.env.SITE_ADMIN_EMAILS = `${ALL_BOOTSTRAP}, LATER@roles.test`;
    assert.deepEqual(await setUserRole(admin, target.id, { area: "platform", value: false }), {
      ok: false,
      error: "bootstrap",
    });

    process.env.SITE_ADMIN_EMAILS = ALL_BOOTSTRAP;
    assert.deepEqual(await setUserRole(admin, target.id, { area: "platform", value: false }), {
      ok: true,
    });
    assert.equal((await readRoles(target.id))?.platform, false);
  });

  test("a bootstrap address may still have its event, training and eVals roles changed", async () => {
    const admin = await scope.createUser("bs2_actor", PERSONAS.platform);
    const target = await scope.createUser("bs2_target", PERSONAS.platform, MORE_BOOTSTRAP[0]);
    assert.deepEqual(await setUserRole(admin, target.id, { area: "event", role: "operator" }), {
      ok: true,
    });
    assert.deepEqual(await setUserRole(admin, target.id, { area: "training", role: "viewer" }), {
      ok: true,
    });
    assert.deepEqual(await setUserRole(admin, target.id, { area: "evals", role: "viewer" }), {
      ok: true,
    });
    assert.deepEqual(await readRoles(target.id), {
      event: "operator",
      training: "viewer",
      evals: "viewer",
      platform: true,
      judging: false,
    });
  });

  test("removing platform administration leaves the stored area roles as they were", async () => {
    // A former platform administrator falls back to whatever they held underneath.
    const admin = await scope.createUser("fall_actor", PERSONAS.platform);
    const target = await scope.createUser("fall_target", {
      event: "manager",
      training: "viewer",
      evals: null,
      platform: true,
      judging: false,
    });
    await setUserRole(admin, target.id, { area: "platform", value: false });
    assert.deepEqual(await readRoles(target.id), {
      event: "manager",
      training: "viewer",
      evals: null,
      platform: false,
      judging: false,
    });
  });

  test("the actor's access is what they were given, not what is stored", async () => {
    // Callers pass the session's access. A stale session that still says
    // administrator is refused only once it expires — pinned so that changing
    // this is a decision, not an accident.
    const actor: TestUser = await scope.createUser("stale", PERSONAS.eventAdmin);
    const target = await scope.createUser("stale_target", PERSONAS.operator);
    await scope.createUser("stale", PERSONAS.nobody);
    assert.deepEqual(await setUserRole(actor, target.id, { area: "event", role: "manager" }), {
      ok: true,
    });
  });
});

describe("listSiteUsers", () => {
  test("reports each user's roles, bootstrap status and event count", async () => {
    const plain = await scope.createUser("list_plain", {
      event: "manager",
      training: "viewer",
      evals: "administrator",
      platform: false,
      judging: false,
    });
    const boot = await scope.createUser("list_boot", PERSONAS.platform, MORE_BOOTSTRAP[1]);
    await createRun(plain.id, "one");
    await createRun(plain.id, "two");

    const page = await listSiteUsers({ ...USER_LIST, q: "list_", page: 1 });
    const listed = new Map(page.rows.map((u) => [u.id, u]));
    assert.ok(page.rows.every((u) => `${u.name} ${u.email}`.includes("list_")), "the search narrows the page");
    assert.deepEqual(
      {
        eventRole: listed.get(plain.id)?.eventRole,
        trainingRole: listed.get(plain.id)?.trainingRole,
        evalsRole: listed.get(plain.id)?.evalsRole,
        isPlatformAdmin: listed.get(plain.id)?.isPlatformAdmin,
        isBootstrapAdmin: listed.get(plain.id)?.isBootstrapAdmin,
        eventCount: listed.get(plain.id)?.eventCount,
      },
      {
        eventRole: "manager",
        trainingRole: "viewer",
        evalsRole: "administrator",
        isPlatformAdmin: false,
        isBootstrapAdmin: false,
        eventCount: 2,
      },
    );
    assert.equal(listed.get(boot.id)?.isBootstrapAdmin, true);
    assert.equal(listed.get(boot.id)?.eventCount, 0);
  });

  test("sorts by any column in the database, and pages", async () => {
    const busy = await scope.createUser("sort_busy", PERSONAS.nobody);
    const idle = await scope.createUser("sort_idle", PERSONAS.nobody);
    await createRun(busy.id, "one");
    const ids = async (dir: "asc" | "desc") =>
      (await listSiteUsers({ q: "sort_", sort: "events", dir, page: 1 })).rows.map((u) => u.id);
    assert.deepEqual(await ids("desc"), [busy.id, idle.id]);
    assert.deepEqual(await ids("asc"), [idle.id, busy.id]);

    const beyond = await listSiteUsers({ q: "sort_", sort: "user", dir: "asc", page: 2 });
    assert.deepEqual([beyond.rows, beyond.hasMore], [[], false]);
  });
});

