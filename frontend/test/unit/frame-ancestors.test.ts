/**
 * The frame allow-list's pure half: what an administrator may type for a
 * domain, and the `frame-ancestors` directive the proxy sends for a list.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { frameAncestors, normalizeFrameDomain } from "@/lib/frame-ancestors";

describe("normalizeFrameDomain", () => {
  test("takes a bare domain, lowercased", () => {
    assert.equal(normalizeFrameDomain(" Harness.MindTickle.com "), "harness.mindtickle.com");
  });

  test("reduces a URL or a wildcard to its domain", () => {
    assert.equal(normalizeFrameDomain("https://harness.mindtickle.com/course/42?x=1"), "harness.mindtickle.com");
    assert.equal(normalizeFrameDomain("mindtickle.com/course"), "mindtickle.com");
    assert.equal(normalizeFrameDomain("mindtickle.com:443"), "mindtickle.com");
    assert.equal(normalizeFrameDomain("*.mindtickle.com"), "mindtickle.com");
  });

  test("refuses what is not a domain", () => {
    for (const bad of ["", "mindtickle", "someone@mindtickle.com", "https://", "*", "'self'", "a b.com", "http://[::1]/"]) {
      assert.equal(normalizeFrameDomain(bad), null, bad);
    }
  });
});

describe("frameAncestors", () => {
  test("is the app's own pages alone with no domains", () => {
    assert.equal(frameAncestors([]), "frame-ancestors 'self'");
  });

  test("adds each domain and its subdomains, with no scheme", () => {
    assert.equal(
      frameAncestors(["mindtickle.com", "example.org"]),
      "frame-ancestors 'self' mindtickle.com *.mindtickle.com example.org *.example.org",
    );
  });
});
