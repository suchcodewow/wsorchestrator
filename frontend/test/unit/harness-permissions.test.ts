/**
 * What a saved Harness token is checked for, and how the answer is read.
 *
 * The token page probes each permission in `PERMISSION_PROBES` and shows the
 * results; the deployer refuses to create an organization unless the token
 * administers the account. So the probe list has to include the one permission
 * the deployer gates on — otherwise `administersAccount` can never be true and
 * every deploy is refused as `not_permitted` — and a permission granted on the
 * wrong entry must not count.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_ADMIN,
  PERMISSION_PROBES,
  administersAccount,
  permissionLabel,
} from "@/lib/harness-permissions";

describe("PERMISSION_PROBES", () => {
  test("asks about each permission once", () => {
    const names = PERMISSION_PROBES.map((p) => p.permission);
    assert.equal(new Set(names).size, names.length);
  });

  test("includes the account-admin permission the deployer gates on", () => {
    const probe = PERMISSION_PROBES.find((p) => p.permission === ACCOUNT_ADMIN);
    assert.ok(probe, `${ACCOUNT_ADMIN} is never probed, so no token could deploy`);
    assert.equal(probe.resourceType, "ACCOUNT");
  });

  test("every probe is a core_ permission with a resource type and a label", () => {
    for (const p of PERMISSION_PROBES) {
      assert.match(p.permission, /^core_[a-z_]+$/, p.permission);
      assert.match(p.resourceType, /^[A-Z_]+$/, p.permission);
      assert.ok(p.label.trim().length > 0, p.permission);
    }
  });

  test("every label is distinct, so the page never shows two identical rows", () => {
    const labels = PERMISSION_PROBES.map((p) => p.label);
    assert.equal(new Set(labels).size, labels.length);
  });
});

describe("administersAccount", () => {
  test("is true when the account-admin permission is granted", () => {
    assert.equal(administersAccount([{ permission: ACCOUNT_ADMIN, permitted: true }]), true);
    assert.equal(
      administersAccount([
        { permission: "core_project_create", permitted: false },
        { permission: ACCOUNT_ADMIN, permitted: true },
      ]),
      true,
    );
  });

  test("is false when it is listed but refused", () => {
    assert.equal(administersAccount([{ permission: ACCOUNT_ADMIN, permitted: false }]), false);
  });

  test("is false when only other permissions are granted, however many", () => {
    const everythingElse = PERMISSION_PROBES.filter((p) => p.permission !== ACCOUNT_ADMIN).map(
      (p) => ({ permission: p.permission, permitted: true }),
    );
    assert.equal(administersAccount(everythingElse), false);
  });

  test("is false with no permissions at all", () => {
    assert.equal(administersAccount([]), false);
  });

  test("matches the permission name exactly", () => {
    for (const near of ["CORE_ACCOUNT_EDIT", "core_account_edit ", "core_account_view", "core_account"]) {
      assert.equal(administersAccount([{ permission: near, permitted: true }]), false, near);
    }
  });
});

describe("permissionLabel", () => {
  test("names every probed permission by its label", () => {
    for (const p of PERMISSION_PROBES) assert.equal(permissionLabel(p.permission), p.label);
    assert.equal(permissionLabel(ACCOUNT_ADMIN), "Administer the account");
  });

  test("shows an unprobed permission by its raw name rather than nothing", () => {
    assert.equal(permissionLabel("core_usergroup_manage"), "core_usergroup_manage");
    assert.equal(permissionLabel(""), "");
  });
});
