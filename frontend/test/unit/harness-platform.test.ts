/**
 * The pure half of the Harness API client: where it points, and how a pasted
 * token is read and remembered.
 *
 * `parseHarnessToken` runs before any request is made, so it decides whether a
 * paste is rejected as malformed (with a sentence telling the person the shape)
 * or sent to Harness; the account id it extracts is the account every deploy
 * with that token goes into. `fingerprint` is how a token is recognised as
 * already saved without keeping it in the clear, so the same token pasted with
 * a stray space must fingerprint the same.
 *
 * The functions that call Harness (`checkHarnessToken`, `listHarnessOrgs`,
 * `listHarnessProjects`, `checkTemplateSource`, `harnessAccountName`) need the
 * network and are not exercised here.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { fingerprint, harnessBaseUrl, harnessOrgUrl, parseHarnessToken } from "@/lib/harness-platform";

const ACCOUNT = "AbCdEf012345_-xyzUVW9";
const TOKEN_ID = "6734a1b2c3d4e5f6a7b8c9d0";
const SECRET = "Zq8vN3pL0sW7yK2mR5tU";
const TOKEN = `pat.${ACCOUNT}.${TOKEN_ID}.${SECRET}`;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.HARNESS_BASE_URL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.HARNESS_BASE_URL;
  else process.env.HARNESS_BASE_URL = saved;
});

describe("harnessBaseUrl", () => {
  test("defaults to the SaaS cluster", () => {
    delete process.env.HARNESS_BASE_URL;
    assert.equal(harnessBaseUrl(), "https://app.harness.io");
  });

  test("uses the configured cluster, without trailing slashes", () => {
    process.env.HARNESS_BASE_URL = "https://app3.harness.io";
    assert.equal(harnessBaseUrl(), "https://app3.harness.io");
    process.env.HARNESS_BASE_URL = "https://harness.example.com/gateway///";
    assert.equal(harnessBaseUrl(), "https://harness.example.com/gateway");
  });

  test("is read on every call, not once at import", () => {
    process.env.HARNESS_BASE_URL = "https://one.example";
    assert.equal(harnessBaseUrl(), "https://one.example");
    process.env.HARNESS_BASE_URL = "https://two.example";
    assert.equal(harnessBaseUrl(), "https://two.example");
  });
});

describe("harnessOrgUrl", () => {
  test("links to the organization's details page on the configured cluster", () => {
    delete process.env.HARNESS_BASE_URL;
    assert.equal(
      harnessOrgUrl(ACCOUNT, "aws_cardinal"),
      `https://app.harness.io/ng/account/${ACCOUNT}/settings/organizations/aws_cardinal/details`,
    );
    process.env.HARNESS_BASE_URL = "https://app3.harness.io/";
    assert.equal(
      harnessOrgUrl("acc", "org"),
      "https://app3.harness.io/ng/account/acc/settings/organizations/org/details",
    );
  });
});

describe("parseHarnessToken", () => {
  test("reads a personal access token", () => {
    assert.deepEqual(parseHarnessToken(TOKEN), {
      kind: "pat",
      accountId: ACCOUNT,
      tokenId: TOKEN_ID,
      tail: SECRET.slice(-4),
    });
  });

  test("reads a service account token", () => {
    assert.equal(parseHarnessToken(`sat.${ACCOUNT}.${TOKEN_ID}.${SECRET}`)?.kind, "sat");
  });

  test("keeps only the last four characters of the secret", () => {
    const parsed = parseHarnessToken(TOKEN);
    assert.equal(parsed?.tail, "R5tU");
    assert.ok(!JSON.stringify(parsed).includes(SECRET), "the secret must not be carried along");
  });

  test("ignores whitespace around a paste", () => {
    assert.deepEqual(parseHarnessToken(`  ${TOKEN}\n`), parseHarnessToken(TOKEN));
  });

  test("rejects a prefix other than pat or sat, including a capitalised one", () => {
    for (const prefix of ["PAT", "Pat", "SAT", "api", "tok", ""]) {
      assert.equal(parseHarnessToken(`${prefix}.${ACCOUNT}.${TOKEN_ID}.${SECRET}`), null, prefix);
    }
  });

  test("rejects too few parts", () => {
    assert.equal(parseHarnessToken(`pat.${ACCOUNT}.${TOKEN_ID}`), null);
    assert.equal(parseHarnessToken(`pat.${ACCOUNT}`), null);
    assert.equal(parseHarnessToken("pat"), null);
    assert.equal(parseHarnessToken(""), null);
    assert.equal(parseHarnessToken("   "), null);
  });

  test("enforces the account and token id lengths (6 to 64)", () => {
    const at = (account: string, tokenId: string) =>
      parseHarnessToken(`pat.${account}.${tokenId}.${SECRET}`);
    assert.notEqual(at("a".repeat(6), TOKEN_ID), null);
    assert.notEqual(at("a".repeat(64), TOKEN_ID), null);
    assert.equal(at("a".repeat(5), TOKEN_ID), null);
    assert.equal(at("a".repeat(65), TOKEN_ID), null);
    assert.notEqual(at(ACCOUNT, "b".repeat(6)), null);
    assert.notEqual(at(ACCOUNT, "b".repeat(64)), null);
    assert.equal(at(ACCOUNT, "b".repeat(5)), null);
    assert.equal(at(ACCOUNT, "b".repeat(65)), null);
  });

  test("requires a secret of at least eight characters", () => {
    assert.notEqual(parseHarnessToken(`pat.${ACCOUNT}.${TOKEN_ID}.12345678`), null);
    assert.equal(parseHarnessToken(`pat.${ACCOUNT}.${TOKEN_ID}.1234567`), null);
  });

  test("rejects characters outside the id alphabet, and whitespace inside", () => {
    assert.equal(parseHarnessToken(`pat.acc!unt12.${TOKEN_ID}.${SECRET}`), null);
    assert.equal(parseHarnessToken(`pat.${ACCOUNT}.tok/en12.${SECRET}`), null);
    assert.equal(parseHarnessToken(`pat.${ACCOUNT}.${TOKEN_ID}.abcd efgh`), null);
    assert.equal(parseHarnessToken(`pat ${ACCOUNT} ${TOKEN_ID} ${SECRET}`), null);
  });

  test("rejects a token pasted with a label in front of it", () => {
    assert.equal(parseHarnessToken(`token: ${TOKEN}`), null);
    assert.equal(parseHarnessToken(`x-api-key=${TOKEN}`), null);
  });
});

describe("fingerprint", () => {
  test("is the SHA-256 of the trimmed token, in hex", () => {
    assert.equal(
      fingerprint("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(fingerprint("  abc\n"), fingerprint("abc"));
  });

  test("tells two tokens apart", () => {
    assert.notEqual(fingerprint(TOKEN), fingerprint(TOKEN.replace(/.$/, "V")));
  });

  test("never contains the token itself", () => {
    assert.ok(!fingerprint(TOKEN).includes(SECRET));
    assert.match(fingerprint(TOKEN), /^[0-9a-f]{64}$/);
  });
});
