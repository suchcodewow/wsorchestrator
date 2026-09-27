/**
 * SITE_ADMIN_EMAILS: the addresses made platform administrators on sign-in.
 *
 * It is the way back in when nobody else can grant platform administration, so
 * a parsing slip here — a stray space, a capital letter from a copy-paste —
 * locks the only person who could fix it out of the fix.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { bootstrapAdminEmails, isBootstrapAdmin } from "@/lib/site-admins";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SITE_ADMIN_EMAILS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.SITE_ADMIN_EMAILS;
  else process.env.SITE_ADMIN_EMAILS = saved;
});

describe("bootstrapAdminEmails", () => {
  test("is empty when unset or blank", () => {
    delete process.env.SITE_ADMIN_EMAILS;
    assert.deepEqual(bootstrapAdminEmails(), []);
    process.env.SITE_ADMIN_EMAILS = "  ,, ";
    assert.deepEqual(bootstrapAdminEmails(), []);
  });

  test("splits on commas, spaces and newlines, and lowercases", () => {
    process.env.SITE_ADMIN_EMAILS = "A@Example.com, b@example.com\nc@example.com  d@example.com";
    assert.deepEqual(bootstrapAdminEmails(), [
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ]);
  });

  test("is read on every call, not once at import", () => {
    process.env.SITE_ADMIN_EMAILS = "one@example.com";
    assert.deepEqual(bootstrapAdminEmails(), ["one@example.com"]);
    process.env.SITE_ADMIN_EMAILS = "two@example.com";
    assert.deepEqual(bootstrapAdminEmails(), ["two@example.com"]);
  });
});

describe("isBootstrapAdmin", () => {
  test("matches regardless of case and surrounding whitespace", () => {
    process.env.SITE_ADMIN_EMAILS = "admin@example.com";
    assert.equal(isBootstrapAdmin("admin@example.com"), true);
    assert.equal(isBootstrapAdmin("Admin@Example.COM"), true);
    assert.equal(isBootstrapAdmin("  admin@example.com "), true);
  });

  test("does not match a different address, a substring, or nothing", () => {
    process.env.SITE_ADMIN_EMAILS = "admin@example.com";
    assert.equal(isBootstrapAdmin("admin@example.co"), false);
    assert.equal(isBootstrapAdmin("xadmin@example.com"), false);
    assert.equal(isBootstrapAdmin("example.com"), false);
    assert.equal(isBootstrapAdmin(""), false);
    assert.equal(isBootstrapAdmin(null), false);
    assert.equal(isBootstrapAdmin(undefined), false);
  });

  test("nobody is a bootstrap administrator when the list is empty", () => {
    delete process.env.SITE_ADMIN_EMAILS;
    assert.equal(isBootstrapAdmin("admin@example.com"), false);
  });
});
