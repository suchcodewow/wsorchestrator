/**
 * Email domain parsing and matching: who may sign in at all.
 *
 * The allow-list is typed by hand into an env var and a settings page, so the
 * parser sees capitals, pasted addresses, trailing dots and stray commas; and
 * the matcher is the sign-in gate, so it sees whatever an identity provider
 * hands back. A lax match lets in `evil.com` for `example.com`; a strict parse
 * locks out the organisation that typed `Example.com`.
 *
 * What these tests pin:
 * - `normalizeDomain` lower-cases, takes the part after the last `@`, drops one
 *   trailing dot, and refuses anything that is not a dotted hostname.
 * - `parseDomainList` splits on commas and whitespace and drops the invalid.
 * - `emailAllowedBy` is an exact match on the domain after the last `@`; an
 *   empty list means no restriction.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { emailAllowedBy, normalizeDomain, parseDomainList } from "@/lib/email-domains";

describe("normalizeDomain", () => {
  test("lower-cases and trims", () => {
    assert.equal(normalizeDomain("  Example.COM  "), "example.com");
  });

  test("takes the domain from a pasted address", () => {
    assert.equal(normalizeDomain("Someone@Harness.io"), "harness.io");
    assert.equal(normalizeDomain("@harness.io"), "harness.io");
    assert.equal(normalizeDomain("a@b@c.example"), "c.example");
  });

  test("drops one trailing dot", () => {
    assert.equal(normalizeDomain("example.com."), "example.com");
    assert.equal(normalizeDomain("example.com.."), null);
  });

  test("accepts subdomains, digits, hyphens and punycode", () => {
    for (const d of ["mail.corp.example.com", "1password.com", "my-co.co.uk", "xn--r8jz45g.jp", "a.b"]) {
      assert.equal(normalizeDomain(d), d);
    }
  });

  test("refuses anything that is not a dotted hostname", () => {
    for (const bad of [
      "",
      "   ",
      "@",
      "localhost",
      "example",
      ".example.com",
      "-example.com",
      "example-.com",
      "example..com",
      "exa mple.com",
      "*.example.com",
      "https://example.com",
      "example.com/",
      "example.com:443",
      "exam_ple.com",
      "例え.jp",
      "example.com\n.evil",
      "someone@",
    ]) {
      assert.equal(normalizeDomain(bad), null, JSON.stringify(bad));
    }
  });
});

describe("parseDomainList", () => {
  test("is empty for nothing", () => {
    assert.deepEqual(parseDomainList(undefined), []);
    assert.deepEqual(parseDomainList(""), []);
    assert.deepEqual(parseDomainList(" ,, \n "), []);
  });

  test("splits on commas, spaces, tabs and newlines", () => {
    assert.deepEqual(parseDomainList("a.com,B.com  c.com\td.com\ne.com, f.com"), [
      "a.com",
      "b.com",
      "c.com",
      "d.com",
      "e.com",
      "f.com",
    ]);
  });

  test("drops invalid entries and keeps the rest", () => {
    assert.deepEqual(parseDomainList("good.com, localhost, *.bad.com, @also.good.com"), [
      "good.com",
      "also.good.com",
    ]);
  });
});

describe("emailAllowedBy", () => {
  const domains = ["example.com", "harness.io"];

  test("an empty list lets everyone in, even with no email", () => {
    assert.equal(emailAllowedBy("anyone@anywhere.example", []), true);
    assert.equal(emailAllowedBy(null, []), true);
    assert.equal(emailAllowedBy(undefined, []), true);
  });

  test("allows a listed domain regardless of case and whitespace", () => {
    assert.equal(emailAllowedBy("a@example.com", domains), true);
    assert.equal(emailAllowedBy("  A.B@Harness.IO ", domains), true);
  });

  test("refuses no email, or one with no @, when a list is set", () => {
    assert.equal(emailAllowedBy(null, domains), false);
    assert.equal(emailAllowedBy(undefined, domains), false);
    assert.equal(emailAllowedBy("", domains), false);
    assert.equal(emailAllowedBy("example.com", domains), false);
  });

  test("matches the whole domain, not a suffix or a prefix", () => {
    for (const email of [
      "a@sub.example.com",
      "a@evilexample.com",
      "a@example.com.evil.example",
      "a@example.co",
      "a@harness.io.",
    ]) {
      assert.equal(emailAllowedBy(email, domains), false, email);
    }
  });

  test("uses the domain after the last @", () => {
    assert.equal(emailAllowedBy("a@example.com@evil.example", domains), false);
    assert.equal(emailAllowedBy('"a@evil.example"@example.com', domains), true);
  });

  test("expects the list already normalised", () => {
    // Callers pass `parseDomainList`/`normalizeDomain` output; a raw capitalised
    // entry does not match.
    assert.equal(emailAllowedBy("a@example.com", ["Example.com"]), false);
    assert.equal(emailAllowedBy("a@example.com", parseDomainList("Example.com")), true);
  });
});
