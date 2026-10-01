/**
 * Which deployment this is, which runs it owns, and when it may offer to
 * import production's backups.
 *
 * An unset `DEPLOYMENT_ENVIRONMENT` has to read as production. Read the other
 * way, production would offer to restore over itself, and would treat its own
 * runs, once stamped, as somebody else's. The import's refusals before any
 * request are pinned too: nothing here reaches Google or the database.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { deploymentEnvironment, isImportedRun, isProduction } from "@/lib/deployment";
import {
  finishSchema,
  productionImportAvailable,
  productionSource,
  startProductionImport,
} from "@/lib/production-import";

const KEYS = [
  "DEPLOYMENT_ENVIRONMENT",
  "PRODUCTION_BACKUP_PROJECT",
  "PRODUCTION_BACKUP_INSTANCE",
  "GCP_ADMIN_PROJECT_ID",
  "CLOUD_SQL_INSTANCE",
  "AUTH_URL",
  "TF_RUNNER_JOB",
] as const;

const QA = {
  DEPLOYMENT_ENVIRONMENT: "qa",
  PRODUCTION_BACKUP_PROJECT: "prod-project",
  PRODUCTION_BACKUP_INSTANCE: "workshops-db",
  GCP_ADMIN_PROJECT_ID: "qa-project",
  CLOUD_SQL_INSTANCE: "workshops-db",
  AUTH_URL: "https://qa.example.com",
  TF_RUNNER_JOB: "tf-runner",
};

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

const asQa = (overrides: Partial<typeof QA> = {}) => Object.assign(process.env, QA, overrides);

describe("deploymentEnvironment", () => {
  test("unset or blank is production", () => {
    assert.equal(deploymentEnvironment(), "production");
    process.env.DEPLOYMENT_ENVIRONMENT = "  ";
    assert.equal(isProduction(), true);
  });

  test("reads QA", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "qa";
    assert.equal(deploymentEnvironment(), "qa");
    assert.equal(isProduction(), false);
  });
});

describe("isImportedRun", () => {
  test("on QA, production's runs are imported and QA's and unstamped ones are not", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "qa";
    assert.equal(isImportedRun({ environment: "production" }), true);
    assert.equal(isImportedRun({ environment: "qa" }), false);
    assert.equal(isImportedRun({ environment: null }), false);
  });

  test("on production, its own stamped runs are its own", () => {
    assert.equal(isImportedRun({ environment: "production" }), false);
    assert.equal(isImportedRun({ environment: null }), false);
  });
});

describe("productionSource", () => {
  test("is QA's configured source", () => {
    asQa();
    assert.deepEqual(productionSource(), { project: "prod-project", instance: "workshops-db" });
    assert.equal(productionImportAvailable(), true);
  });

  test("is never offered on production, even when configured", () => {
    asQa({ DEPLOYMENT_ENVIRONMENT: "production" });
    assert.equal(productionSource(), null);
    asQa({ DEPLOYMENT_ENVIRONMENT: "" });
    assert.equal(productionSource(), null);
  });

  test("is refused when it is this deployment's own project", () => {
    asQa({ PRODUCTION_BACKUP_PROJECT: "qa-project" });
    assert.equal(productionSource(), null);
  });

  test("needs both the project and the instance", () => {
    asQa({ PRODUCTION_BACKUP_INSTANCE: "" });
    assert.equal(productionImportAvailable(), false);
  });
});

describe("startProductionImport refuses before any request", () => {
  test("on production", async () => {
    asQa({ DEPLOYMENT_ENVIRONMENT: "production" });
    const result = await startProductionImport({ backupId: "1", confirmation: "workshops-db", actorEmail: "a" });
    assert.deepEqual(result, { ok: false, error: "not_configured" });
  });

  test("without a URL for the job to call back", async () => {
    asQa({ AUTH_URL: "" });
    const result = await startProductionImport({ backupId: "1", confirmation: "workshops-db", actorEmail: "a" });
    assert.deepEqual(result, { ok: false, error: "not_configured" });
  });

  test("unless QA's own instance name is typed", async () => {
    asQa({ CLOUD_SQL_INSTANCE: "qa-db", PRODUCTION_BACKUP_INSTANCE: "prod-db" });
    const result = await startProductionImport({ backupId: "1", confirmation: "prod-db", actorEmail: "a" });
    assert.deepEqual(result, { ok: false, error: "confirmation_mismatch" });
  });
});

describe("finishSchema", () => {
  // Only the import job calls this, and its backup ids are Cloud SQL's int64s.
  test("takes only a numeric backup id", () => {
    assert.equal(finishSchema.safeParse({ backupId: "1", actor: "a", snapshot: [] }).success, true);
    assert.equal(finishSchema.safeParse({ backupId: "x", actor: "a", snapshot: [] }).success, false);
  });
});
