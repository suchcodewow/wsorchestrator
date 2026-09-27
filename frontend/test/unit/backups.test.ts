/**
 * Cloud SQL backups: the parts that decide *whether* to call the Cloud SQL
 * Admin API, and the audit line written afterwards.
 *
 * A restore overwrites the production database. The guards pinned here are
 * the ones that run before any request: an unconfigured deployment reports
 * `not_configured` rather than calling Google with an empty project, and a
 * restore refuses unless the typed confirmation is the instance's own name.
 * The audit line is the only record of who restored what — Cloud Logging
 * indexes it by `severity` and `component`, so those are pinned too.
 *
 * Nothing here reaches Google: every case either has no target configured or
 * fails the confirmation, both of which return before `GoogleAuth` is built.
 * `runsStrandedBy` reads the database and is not exercised.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { auditBackupAction, backupTarget, createBackup, listBackups, restoreBackup } from "@/lib/backups";

const KEYS = ["GCP_ADMIN_PROJECT_ID", "CLOUD_SQL_INSTANCE"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("backupTarget", () => {
  test("is null unless both the project and the instance are set", () => {
    assert.equal(backupTarget(), null);
    process.env.GCP_ADMIN_PROJECT_ID = "admin-project";
    assert.equal(backupTarget(), null);
    delete process.env.GCP_ADMIN_PROJECT_ID;
    process.env.CLOUD_SQL_INSTANCE = "workshops";
    assert.equal(backupTarget(), null);
    process.env.GCP_ADMIN_PROJECT_ID = "";
    assert.equal(backupTarget(), null);
  });

  test("is the pair when both are set", () => {
    process.env.GCP_ADMIN_PROJECT_ID = "admin-project";
    process.env.CLOUD_SQL_INSTANCE = "workshops";
    assert.deepEqual(backupTarget(), { project: "admin-project", instance: "workshops" });
  });
});

describe("unconfigured", () => {
  test("listing, taking and restoring all report not_configured", async () => {
    assert.deepEqual(await listBackups(), { ok: false, error: "not_configured" });
    assert.deepEqual(await createBackup("before migration"), { ok: false, error: "not_configured" });
    assert.deepEqual(await restoreBackup("123", "workshops"), { ok: false, error: "not_configured" });
  });
});

describe("restoreBackup confirmation", () => {
  beforeEach(() => {
    process.env.GCP_ADMIN_PROJECT_ID = "admin-project";
    process.env.CLOUD_SQL_INSTANCE = "workshops-prod";
  });

  test("anything but the instance name is a mismatch", async () => {
    for (const typed of ["", "workshops", "Workshops-Prod", "workshops-prod-x", "admin-project", "yes"]) {
      assert.deepEqual(
        await restoreBackup("123", typed),
        { ok: false, error: "confirmation_mismatch" },
        JSON.stringify(typed),
      );
    }
  });
});

describe("auditBackupAction", () => {
  let lines: string[];
  let original: typeof console.log;
  beforeEach(() => {
    lines = [];
    original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  });
  afterEach(() => {
    console.log = original;
  });

  test("writes one structured NOTICE line with everything it was given", () => {
    auditBackupAction({
      action: "restore",
      actorId: "u1",
      actorEmail: "admin@example.com",
      backupId: "1695800000000",
      backupTime: "2026-09-27T03:00:00.000Z",
      strandedRunIds: ["r1", "r2"],
    });
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.severity, "NOTICE");
    assert.equal(entry.component, "backups");
    assert.ok(!Number.isNaN(Date.parse(entry.at)));
    assert.deepEqual(
      { ...entry, at: undefined },
      {
        severity: "NOTICE",
        component: "backups",
        at: undefined,
        action: "restore",
        actorId: "u1",
        actorEmail: "admin@example.com",
        backupId: "1695800000000",
        backupTime: "2026-09-27T03:00:00.000Z",
        strandedRunIds: ["r1", "r2"],
      },
    );
  });

  test("an on-demand backup needs only the actor", () => {
    auditBackupAction({ action: "backup", actorId: "u1", actorEmail: "a@example.com" });
    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.action, "backup");
    assert.equal("backupId" in entry, false);
  });
});
