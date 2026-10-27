/**
 * Test accounts: their addresses, and which changes go through while viewing
 * the app as one. Production must refuse every change, whatever the route,
 * and an unset `DEPLOYMENT_ENVIRONMENT` is production.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { TEST_ACCOUNT_DOMAIN, testAccountEmail, testAccountMayChange, testAccountsAllowed } from "@/lib/test-accounts";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.DEPLOYMENT_ENVIRONMENT;
  delete process.env.DEPLOYMENT_ENVIRONMENT;
});
afterEach(() => {
  if (saved === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT;
  else process.env.DEPLOYMENT_ENVIRONMENT = saved;
});

describe("testAccountEmail", () => {
  test("is the name, made safe, on the reserved domain", () => {
    assert.equal(testAccountEmail("Diagnostic tester, SDR track", "abc123"), `diagnostic-tester-sdr-track-abc123@${TEST_ACCOUNT_DOMAIN}`);
    assert.equal(testAccountEmail("  Zoë  ", "abc123"), `zoe-abc123@${TEST_ACCOUNT_DOMAIN}`);
  });

  test("still has a local part when nothing in the name survives", () => {
    assert.equal(testAccountEmail("!!!", "abc123"), `test-abc123@${TEST_ACCOUNT_DOMAIN}`);
  });

  test("is on a domain nobody can sign in from", () => {
    assert.ok(TEST_ACCOUNT_DOMAIN.endsWith(".invalid"));
  });

  test("differs between two accounts of the same name", () => {
    assert.notEqual(testAccountEmail("Same"), testAccountEmail("Same"));
  });
});

describe("testAccountMayChange", () => {
  const tokenRoute = { token: true };
  const sessionOnly = { token: false };

  test("outside production, lets a route a token could call through", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "qa";
    assert.equal(testAccountsAllowed(), true);
    assert.equal(testAccountMayChange(tokenRoute), true);
  });

  test("refuses a session-only route, and one missing from the catalog", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "qa";
    assert.equal(testAccountMayChange(sessionOnly), false);
    assert.equal(testAccountMayChange(null), false);
    assert.equal(testAccountMayChange(undefined), false);
  });

  test("on production, refuses everything, unset meaning production", () => {
    assert.equal(testAccountsAllowed(), false);
    assert.equal(testAccountMayChange(tokenRoute), false);
    process.env.DEPLOYMENT_ENVIRONMENT = "production";
    assert.equal(testAccountMayChange(tokenRoute), false);
  });
});
