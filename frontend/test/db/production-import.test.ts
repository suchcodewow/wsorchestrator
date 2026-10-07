/**
 * QA's production import: what QA may do to an imported run, and what the
 * finish step leaves behind.
 *
 * The first half runs in the scratch database like every other suite. An
 * imported run must stay visible but refuse every change, because each change
 * hands a production workshop to QA's runner, and QA shares production's
 * accounts.
 *
 * The finish step rewrites every row in the database it is given (it revokes
 * everyone's roles and empties the credential tables), so the second half
 * builds a database of its own on the same local server, fills it as a
 * production backup would be, and drops it afterwards.
 */

import "../support/test-env";

process.env.DEPLOYMENT_ENVIRONMENT = "qa";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import pg from "pg";

import { db } from "@/db";
import { workshopRuns } from "@/db/schema";
import { isImportedRun } from "@/lib/deployment";
import { finishProductionImport, localRunsHoldingResources } from "@/lib/production-import";
import { deleteRun, endRunNow, extendRun, getRunForViewer, retryTeardown, updateRunConfig } from "@/lib/runs";
import { PERSONAS } from "../support/access";
import { testDatabaseUrl } from "../support/db";
import { createRun, testScope } from "../support/seed";

const scope = testScope("imp");

before(() => scope.setUp());
after(() => scope.tearDown());

async function stamp(runId: string, environment: string | null, status = "ready") {
  await db
    .update(workshopRuns)
    .set({ environment, status: status as "ready" })
    .where(eq(workshopRuns.id, runId));
}

describe("an imported run", () => {
  test("is shown but cannot be changed", async () => {
    const admin = await scope.createUser("admin", PERSONAS.platform);
    const viewer = { id: admin.id, access: admin.access };
    const runId = await createRun(admin.id, "imported");
    await stamp(runId, "production");

    const shown = await getRunForViewer(runId, viewer);
    assert.ok(shown, "an imported run is still visible");
    assert.equal(isImportedRun(shown.run), true);

    assert.deepEqual(await endRunNow(runId, viewer), { ok: false, error: "not_found" });
    assert.deepEqual(await extendRun(runId, viewer), { ok: false, error: "not_found" });
    assert.deepEqual(await retryTeardown(runId, viewer), { ok: false, error: "not_found" });
    assert.deepEqual(
      await updateRunConfig(runId, viewer, { userCount: 2, clouds: [] }),
      { ok: false, error: "not_found" },
    );
    assert.deepEqual(await deleteRun(runId, viewer), { ok: false, error: "not_found" });

    const [row] = await db.select().from(workshopRuns).where(eq(workshopRuns.id, runId));
    assert.equal(row?.status, "ready");
    assert.equal(row?.deleteRequested, false);
  });

  test("does not block an import, since it holds nothing of this deployment's", async () => {
    const admin = await scope.createUser("admin", PERSONAS.platform);
    const imported = await createRun(admin.id, "imported");
    await stamp(imported, "production");
    const own = await createRun(admin.id, "own");
    await stamp(own, "qa");

    const holding = (await localRunsHoldingResources()).map((r) => r.id);
    assert.ok(!holding.includes(imported));
    assert.ok(holding.includes(own));

    // Back to scheduled, so nothing else in this database sees a live run.
    await stamp(own, "qa", "scheduled");
  });

  // Unstamped rows predate the column and are the database's own.
  test("is only one stamped by another deployment", async () => {
    const admin = await scope.createUser("admin", PERSONAS.platform);
    const viewer = { id: admin.id, access: admin.access };
    for (const environment of [null, "qa"]) {
      const runId = await createRun(admin.id, `own ${environment}`);
      await stamp(runId, environment, "scheduled");
      assert.deepEqual(await deleteRun(runId, viewer), { ok: true, outcome: "deleted" });
    }
  });
});

/* ------------------------------------------------------------------ */

const PROBE = "workshops_import_test";

function urlFor(database: string) {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

async function onServer(fn: (c: pg.Client) => Promise<unknown>) {
  const client = new pg.Client({ connectionString: urlFor("postgres") });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

describe("finishProductionImport", () => {
  const url = urlFor(PROBE);
  let probe: pg.Client;

  before(async () => {
    // scope.setUp has checked that testDatabaseUrl() is a scratch database on
    // the local server; this one sits beside it and belongs to this suite.
    await onServer(async (c) => {
      await c.query(`drop database if exists ${PROBE}`);
      await c.query(`create database ${PROBE}`);
    });
    const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    assert.equal(push.status, 0, push.stderr || push.stdout);

    probe = new pg.Client({ connectionString: url });
    await probe.connect();

    // As a production backup arrives, after the job's quarantine.
    await probe.query(`
      insert into users (id, email, site_role, is_platform_admin) values
        ('prod-admin', 'prod-admin@example.test', 'administrator', true),
        ('prod-qa-admin', 'qa-admin@example.test', 'none', false),
        ('qa-admin', 'someone-else@example.test', 'contributor', false);
      insert into accounts ("userId", type, provider, "providerAccountId", refresh_token, access_token, id_token)
        values ('prod-admin', 'oidc', 'google', 'g-prod', 'rt', 'at', 'it');
      insert into sessions ("sessionToken", "userId", expires)
        values ('prod-session', 'prod-admin', now() + interval '1 day');
      insert into api_tokens (user_id, name, prefix, token_hash, expires_at)
        values ('prod-admin', 't', 'wo_x', 'h', now() + interval '1 day');
      insert into harness_tokens (user_id, kind, account_id, tail, fingerprint, secret)
        values ('prod-admin', 'pat', 'acct', 'abcd', 'fp', '\\x00');
      insert into workshop_runs (id, user_id, name, slug, user_count, state_prefix, status, environment)
        values ('00000000-0000-0000-0000-000000000001', 'prod-admin', 'live', 'live', 1, 'p/live', 'ready', 'production');
      insert into workshop_accounts (run_id, email, temp_password)
        values ('00000000-0000-0000-0000-000000000001', 'attendee@example.test', 'hunter2');
      insert into google_connections (key, email, refresh_token, scope)
        values ('meetings', 'invites@example.test', '\\x00', 'calendar');
      insert into google_meetings (title, starts_at, duration_minutes, google_event_id)
        values ('Kickoff', now() + interval '1 day', 30, 'prod-event');
    `);
  });

  after(async () => {
    await probe?.end().catch(() => {});
    await onServer((c) => c.query(`drop database if exists ${PROBE}`));
  });

  test("leaves QA's users in charge and none of production's credentials", async () => {
    const result = await finishProductionImport(
      {
        snapshot: [
          {
            // Has a row in production under another id: that row gets the roles.
            id: "qa-admin-id",
            email: "QA-Admin@example.test",
            name: "QA Admin",
            image: null,
            eventRole: "administrator",
            trainingRole: null,
            evalsRole: null,
            irisRole: null,
            isPlatformAdmin: true,
            calendarScope: "own",
            accounts: [{ type: "oidc", provider: "google", providerAccountId: "g-qa" }],
          },
          {
            // Not in production at all, and its QA id is taken there.
            id: "qa-admin",
            email: "new@example.test",
            name: "New",
            image: null,
            eventRole: "operator",
            trainingRole: "viewer",
            evalsRole: null,
            irisRole: "taker",
            isPlatformAdmin: false,
            calendarScope: "all",
            accounts: [{ type: "oidc", provider: "google", providerAccountId: "g-new" }],
          },
        ],
      },
      { connectionString: url },
    );

    assert.equal(result.usersRestored, 1);
    assert.equal(result.usersAdded, 1);
    assert.equal(result.attendeePasswordsCleared, 1);
    assert.ok(result.migrations.includes("0035_run_environment.sql"));

    const q = async (sql: string) => (await probe.query(sql)).rows;
    const added = (await q(`select id from users where email = 'new@example.test'`))[0].id;
    assert.notEqual(added, "qa-admin", "a QA id production already uses is not reused");

    assert.deepEqual(
      await q(`select id, site_role::text as role, is_platform_admin as platform from users order by email`),
      [
        { id: added, role: "operator", platform: false },
        { id: "prod-admin", role: "none", platform: false },
        { id: "prod-qa-admin", role: "administrator", platform: true },
        { id: "qa-admin", role: "none", platform: false },
      ],
    );

    assert.deepEqual(await q(`select "userId", "providerAccountId" from accounts order by "providerAccountId"`), [
      { userId: added, providerAccountId: "g-new" },
      { userId: "prod-admin", providerAccountId: "g-prod" },
      { userId: "prod-qa-admin", providerAccountId: "g-qa" },
    ]);
    assert.deepEqual(
      await q(`select refresh_token, access_token, id_token from accounts where "providerAccountId" = 'g-prod'`),
      [{ refresh_token: null, access_token: null, id_token: null }],
    );

    for (const table of ["sessions", "api_tokens", "harness_tokens", "user_invites", "google_connections", "google_meetings"]) {
      assert.equal((await q(`select count(*)::int as n from ${table}`))[0].n, 0, table);
    }
    assert.deepEqual(await q(`select temp_password from workshop_accounts`), [{ temp_password: "" }]);
    assert.deepEqual(await q(`select environment, status::text from workshop_runs`), [
      { environment: "production", status: "ready" },
    ]);
  });

  test("is safe to run twice", async () => {
    await finishProductionImport(
      { snapshot: [] },
      { connectionString: url },
    );
    const admins = (await probe.query(`select count(*)::int as n from users where is_platform_admin`)).rows[0].n;
    assert.equal(admins, 0, "an empty snapshot leaves nobody in charge; bootstrap admins regain it on sign-in");
  });
});
