/**
 * The decisions behind importing a production backup into QA.
 *
 * Each of these is a guardrail rather than plumbing. Read the configuration
 * wrong and production restores over itself. Read the executions wrong and a
 * teardown dies halfway with its record erased. Resume at the wrong moment and
 * QA's reaper is handed production's live workshops. So they are pinned here,
 * away from the API calls they sit between.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  QUARANTINE_SQL,
  databaseCredentials,
  importConfig,
  operationState,
  otherRunningExecutions,
  refusedOutright,
  shouldResume,
} from "../src/import-policy.js";

const QA = {
  DEPLOYMENT_ENVIRONMENT: "qa",
  PRODUCTION_BACKUP_PROJECT: "prod-project",
  PRODUCTION_BACKUP_INSTANCE: "workshops-db",
  GCP_ADMIN_PROJECT_ID: "qa-project",
  CLOUD_SQL_INSTANCE: "workshops-db",
  GCP_REGION: "us-central1",
  BACKUP_ID: "1727740800000",
  IMPORT_FINISH_URL: "https://qa.example.com/api/backups/production/finish",
  IMPORT_ACTOR: "admin@example.com",
};

describe("importConfig", () => {
  test("accepts QA's configuration", () => {
    const result = importConfig(QA);
    assert.ok(result.ok);
    assert.deepEqual(result.config.source, { project: "prod-project", instance: "workshops-db" });
    assert.deepEqual(result.config.target, { project: "qa-project", instance: "workshops-db" });
    assert.equal(result.config.actor, "admin@example.com");
  });

  test("refuses production", () => {
    const result = importConfig({ ...QA, DEPLOYMENT_ENVIRONMENT: "production" });
    assert.equal(result.ok, false);
  });

  // Unset means production everywhere else in the runner, so it must here too.
  test("refuses a deployment that does not say which it is", () => {
    for (const value of [undefined, "", "  "]) {
      const result = importConfig({ ...QA, DEPLOYMENT_ENVIRONMENT: value });
      assert.equal(result.ok, false, `DEPLOYMENT_ENVIRONMENT=${JSON.stringify(value)}`);
    }
  });

  test("refuses a source in the deployment's own project", () => {
    const result = importConfig({ ...QA, PRODUCTION_BACKUP_PROJECT: "qa-project" });
    assert.equal(result.ok, false);
  });

  test("names everything that is missing", () => {
    const result = importConfig({ DEPLOYMENT_ENVIRONMENT: "qa" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      for (const name of [
        "PRODUCTION_BACKUP_PROJECT",
        "PRODUCTION_BACKUP_INSTANCE",
        "GCP_ADMIN_PROJECT_ID",
        "CLOUD_SQL_INSTANCE",
        "BACKUP_ID",
        "IMPORT_FINISH_URL",
      ]) {
        assert.match(result.reason, new RegExp(name));
      }
    }
  });

  test("refuses a backup id that is not a number", () => {
    assert.equal(importConfig({ ...QA, BACKUP_ID: "1/../../instances/x" }).ok, false);
  });

  // The finish request carries an ID token and QA's users. Plain http would put
  // both on the wire.
  test("refuses a plain-http finish URL anywhere but localhost", () => {
    assert.equal(importConfig({ ...QA, IMPORT_FINISH_URL: "http://qa.example.com/x" }).ok, false);
    assert.ok(importConfig({ ...QA, IMPORT_FINISH_URL: "http://localhost:3100/x" }).ok);
  });
});

describe("databaseCredentials", () => {
  test("reads the Cloud Run socket form", () => {
    assert.deepEqual(
      databaseCredentials(
        "postgresql://appuser:s3cret@localhost/workshops?host=/cloudsql/p:us-central1:workshops-db",
      ),
      { user: "appuser", password: "s3cret" },
    );
  });

  test("decodes an escaped password", () => {
    assert.deepEqual(databaseCredentials("postgresql://appuser:a%2Fb%40c@localhost/db"), {
      user: "appuser",
      password: "a/b@c",
    });
  });

  test("is null without a password to restore", () => {
    assert.equal(databaseCredentials("postgresql://appuser@localhost/db"), null);
    assert.equal(databaseCredentials(undefined), null);
    assert.equal(databaseCredentials("not a url"), null);
  });
});

describe("operationState", () => {
  test("running until DONE", () => {
    assert.deepEqual(operationState({ status: "PENDING" }), { state: "running" });
    assert.deepEqual(operationState({ status: "RUNNING" }), { state: "running" });
    assert.deepEqual(operationState({}), { state: "running" });
  });

  test("DONE without errors is done", () => {
    assert.deepEqual(operationState({ status: "DONE" }), { state: "done" });
  });

  // A failed restore is still DONE. Reading DONE alone as success would carry
  // on to quarantine a database that never changed.
  test("DONE with errors is a failure, with the message", () => {
    const state = operationState({
      status: "DONE",
      error: { errors: [{ code: "ERROR_RDBMS", message: "backup is not restorable" }] },
    });
    assert.deepEqual(state, { state: "failed", message: "ERROR_RDBMS: backup is not restorable" });
  });
});

describe("otherRunningExecutions", () => {
  const base = "projects/p/locations/us-central1/jobs/tf-runner/executions";

  test("ignores finished executions and this one", () => {
    const running = otherRunningExecutions(
      [
        { name: `${base}/tf-runner-abc`, completionTime: "2026-10-01T00:00:00Z" },
        { name: `${base}/tf-runner-self` },
        { name: `${base}/tf-runner-other` },
      ],
      "tf-runner-self",
    );
    assert.deepEqual(running, [`${base}/tf-runner-other`]);
  });

  // A name that merely starts the same must not be mistaken for this one.
  test("matches its own execution exactly", () => {
    assert.deepEqual(
      otherRunningExecutions([{ name: `${base}/tf-runner-self2` }], "tf-runner-self"),
      [`${base}/tf-runner-self2`],
    );
  });
});

describe("refusedOutright", () => {
  test("a 4xx never started anything", () => {
    assert.equal(refusedOutright({ response: { status: 403 } }), true);
    assert.equal(refusedOutright({ response: { status: 409 } }), true);
  });

  // A timeout or a 5xx may have reached Cloud SQL, and the restore with it.
  test("anything else might have", () => {
    assert.equal(refusedOutright({ response: { status: 503 } }), false);
    assert.equal(refusedOutright(new Error("socket hang up")), false);
    assert.equal(refusedOutright(undefined), false);
  });
});

describe("shouldResume", () => {
  test("resumes when the restore never started", () => {
    assert.equal(shouldResume({ restoreStarted: false, quarantined: false }), true);
  });

  test("resumes once the imported runs are stamped", () => {
    assert.equal(shouldResume({ restoreStarted: true, quarantined: true }), true);
  });

  // The one state where the reaper would tear down production's workshops.
  test("stays paused between the restore and the stamp", () => {
    assert.equal(shouldResume({ restoreStarted: true, quarantined: false }), false);
  });
});

describe("QUARANTINE_SQL", () => {
  test("stamps every run, not only the unstamped ones", () => {
    assert.ok(
      QUARANTINE_SQL.some((s) => /^update workshop_runs set environment = 'production'$/.test(s)),
    );
  });

  // The reaper's scrub sweep overwrites these in the shared Harness account.
  test("drops production's pending secret scrubs", () => {
    assert.ok(QUARANTINE_SQL.some((s) => /delete from harness_deployed_secrets/.test(s)));
  });

  // Production's schema can be older than QA's.
  test("adds the column before using it", () => {
    const add = QUARANTINE_SQL.findIndex((s) => /add column if not exists environment/.test(s));
    const stamp = QUARANTINE_SQL.findIndex((s) => /set environment/.test(s));
    assert.ok(add >= 0 && add < stamp);
  });
});
