/**
 * The sign-in domain allow-list: the parts that decide without the database.
 *
 * The list is the union of `AUTH_ALLOWED_EMAIL_DOMAINS` and rows an administrator
 * adds on the settings page. Most of this module reads and writes those rows and
 * is not tested here. What is: the env half, the input schema the settings API
 * validates against, the status each refusal maps to, and the two early exits
 * that must not wait on the database — a bootstrap administrator always gets in,
 * and a malformed domain is refused before anything is read. The pool is
 * replaced with one that fails the test if touched.
 */

import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { pool } from "@/db";
import { ALLOWED_DOMAIN_LIMITS } from "@/db/schema";
import {
  STATUS_FOR,
  addAllowedDomain,
  domainInputSchema,
  envAllowedDomains,
  isEmailAllowed,
  updateAllowedDomain,
  type DomainError,
} from "@/lib/allowed-domains";

const p = pool as unknown as Record<string, unknown>;
const savedPool = { connect: p.connect, query: p.query };
before(() => {
  p.connect = () => {
    throw new Error("the test reached the database");
  };
  p.query = p.connect;
});
after(() => {
  p.connect = savedPool.connect;
  p.query = savedPool.query;
});

const ENV = ["AUTH_ALLOWED_EMAIL_DOMAINS", "SITE_ADMIN_EMAILS"] as const;
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const ACTOR = { id: "u1", email: "someone@example.com" };

describe("envAllowedDomains", () => {
  test("is empty when unset or blank", () => {
    delete process.env.AUTH_ALLOWED_EMAIL_DOMAINS;
    assert.deepEqual(envAllowedDomains(), []);
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = " , ";
    assert.deepEqual(envAllowedDomains(), []);
  });

  test("normalises and drops invalid entries", () => {
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = "Harness.io, @example.com\nlocalhost";
    assert.deepEqual(envAllowedDomains(), ["harness.io", "example.com"]);
  });

  test("is read on every call", () => {
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = "one.example";
    assert.deepEqual(envAllowedDomains(), ["one.example"]);
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = "two.example";
    assert.deepEqual(envAllowedDomains(), ["two.example"]);
  });
});

describe("isEmailAllowed", () => {
  test("lets a bootstrap administrator in without consulting the list", async () => {
    // The way back in when the list is wrong must not depend on the list.
    process.env.SITE_ADMIN_EMAILS = "admin@elsewhere.example";
    process.env.AUTH_ALLOWED_EMAIL_DOMAINS = "example.com";
    assert.equal(await isEmailAllowed("Admin@Elsewhere.example"), true);
  });
});

describe("domainInputSchema", () => {
  test("accepts a domain with or without a note", () => {
    assert.equal(domainInputSchema.safeParse({ domain: "example.com" }).success, true);
    assert.equal(domainInputSchema.safeParse({ domain: "example.com", note: "Acme" }).success, true);
  });

  test("refuses an empty, missing or non-string domain", () => {
    for (const input of [{ domain: "" }, {}, { domain: 5 }, { domain: null }]) {
      assert.equal(domainInputSchema.safeParse(input).success, false, JSON.stringify(input));
    }
  });

  test("bounds the domain and the note at the column limits", () => {
    const at = (n: number) => "a".repeat(n);
    assert.equal(domainInputSchema.safeParse({ domain: at(ALLOWED_DOMAIN_LIMITS.domain) }).success, true);
    assert.equal(domainInputSchema.safeParse({ domain: at(ALLOWED_DOMAIN_LIMITS.domain + 1) }).success, false);
    assert.equal(
      domainInputSchema.safeParse({ domain: "a.b", note: at(ALLOWED_DOMAIN_LIMITS.note) }).success,
      true,
    );
    assert.equal(
      domainInputSchema.safeParse({ domain: "a.b", note: at(ALLOWED_DOMAIN_LIMITS.note + 1) }).success,
      false,
    );
  });

  test("keeps only domain and note", () => {
    const parsed = domainInputSchema.parse({ domain: "a.b", note: "n", createdBy: "someone-else" });
    assert.deepEqual(parsed, { domain: "a.b", note: "n" });
  });
});

describe("STATUS_FOR", () => {
  test("maps every refusal to an HTTP error status", () => {
    const expected: Record<DomainError, number> = {
      invalid: 400,
      duplicate: 409,
      not_found: 404,
      self_lockout: 409,
    };
    assert.deepEqual(STATUS_FOR, expected);
  });
});

describe("malformed domains are refused before the database", () => {
  for (const domain of ["", "localhost", "*.example.com", "https://example.com", "exa mple.com"]) {
    test(`add ${JSON.stringify(domain)}`, async () => {
      assert.deepEqual(await addAllowedDomain(ACTOR, { domain }), { ok: false, error: "invalid" });
    });
    test(`update to ${JSON.stringify(domain)}`, async () => {
      assert.deepEqual(await updateAllowedDomain(ACTOR, "id", { domain }), { ok: false, error: "invalid" });
    });
  }
});
