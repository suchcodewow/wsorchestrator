/**
 * The LTI 1.3 launch from Mindtickle: the login initiation's checks, the
 * authorization redirect it builds, and every check `verifyLaunch` makes on
 * the id_token. Tokens are signed here with a throwaway RSA key and checked
 * against a local key set, so nothing is fetched.
 */

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, type JWTVerifyGetKey } from "jose";

import { authorizeUrl, loginProblem, ltiPlatform, newLoginState, verifyLaunch, type LtiPlatform } from "@/lib/lti";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";

const platform: LtiPlatform = {
  issuer: "https://harness.mindtickle.com",
  clientId: "tool-client",
  deploymentIds: ["dep-1"],
  authUrl: "https://harness.mindtickle.com/lti/authorize?tenant=1",
  jwksUrl: "https://harness.mindtickle.com/lti/jwks",
};

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let keys: JWTVerifyGetKey;

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
});

function claims(over: JWTPayload = {}): JWTPayload {
  return {
    sub: "user-42",
    nonce: "n-1",
    email: "learner@harness.io",
    [`${CLAIM}deployment_id`]: "dep-1",
    [`${CLAIM}version`]: "1.3.0",
    [`${CLAIM}message_type`]: "LtiResourceLinkRequest",
    ...over,
  };
}

async function token(
  payload: JWTPayload = claims(),
  opts: { key?: CryptoKey; iss?: string; aud?: string | string[]; exp?: number | string } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? platform.issuer)
    .setAudience(opts.aud ?? platform.clientId)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

const failed = (r: { checks: { name: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.name);

describe("ltiPlatform", () => {
  test("is null until every required setting is present, and splits the deployments", () => {
    const names = ["LTI_ISSUER", "LTI_CLIENT_ID", "LTI_AUTH_URL", "LTI_JWKS_URL", "LTI_DEPLOYMENT_IDS"];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      for (const n of names) delete process.env[n];
      assert.equal(ltiPlatform(), null);
      process.env.LTI_ISSUER = " https://harness.mindtickle.com\n";
      process.env.LTI_CLIENT_ID = "tool-client";
      process.env.LTI_AUTH_URL = "https://harness.mindtickle.com/lti/authorize";
      assert.equal(ltiPlatform(), null);
      process.env.LTI_JWKS_URL = "https://harness.mindtickle.com/lti/jwks";
      assert.deepEqual(ltiPlatform()?.deploymentIds, []);
      assert.equal(ltiPlatform()?.issuer, "https://harness.mindtickle.com");
      process.env.LTI_DEPLOYMENT_IDS = "dep-1, dep-2,,";
      assert.deepEqual(ltiPlatform()?.deploymentIds, ["dep-1", "dep-2"]);
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    }
  });
});

describe("loginProblem", () => {
  const ok = { iss: platform.issuer, login_hint: "u", target_link_uri: "https://app/x" };

  test("accepts a login from the configured platform", () => {
    assert.equal(loginProblem(platform, ok), null);
    assert.equal(loginProblem(platform, { ...ok, client_id: platform.clientId }), null);
  });

  test("refuses one missing a parameter, from another issuer, or for another client", () => {
    assert.equal(loginProblem(platform, { ...ok, login_hint: undefined }), "missing_parameter");
    assert.equal(loginProblem(platform, { ...ok, iss: "https://evil.example" }), "unknown_issuer");
    assert.equal(loginProblem(platform, { ...ok, client_id: "someone-else" }), "unknown_client");
  });
});

describe("authorizeUrl", () => {
  test("asks for a form-posted id_token, keeping the auth URL's own query", () => {
    const login = newLoginState();
    const url = new URL(
      authorizeUrl(platform, { login_hint: "u-1", lti_message_hint: "m-1" }, "https://app/api/lti/launch", login),
    );
    const q = Object.fromEntries(url.searchParams);
    assert.equal(url.origin + url.pathname, "https://harness.mindtickle.com/lti/authorize");
    assert.deepEqual(q, {
      tenant: "1",
      scope: "openid",
      response_type: "id_token",
      response_mode: "form_post",
      prompt: "none",
      client_id: "tool-client",
      redirect_uri: "https://app/api/lti/launch",
      login_hint: "u-1",
      state: login.state,
      nonce: login.nonce,
      lti_message_hint: "m-1",
    });
  });

  test("states and nonces fit the launch's state pattern and do not repeat", () => {
    const a = newLoginState();
    const b = newLoginState();
    assert.match(a.state, /^[A-Za-z0-9_-]{32}$/);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.nonce, b.nonce);
  });
});

describe("verifyLaunch", () => {
  test("verifies a well-formed launch and returns its claims", async () => {
    const r = await verifyLaunch(platform, await token(), "n-1", keys);
    assert.deepEqual(failed(r), []);
    assert.equal(r.verified, true);
    assert.equal(r.claims?.email, "learner@harness.io");
    assert.equal(r.header?.kid, "k1");
  });

  test("refuses a token that is not a JWT", async () => {
    const r = await verifyLaunch(platform, "not-a-token", "n-1", keys);
    assert.equal(r.verified, false);
    assert.deepEqual(failed(r), ["token"]);
  });

  test("refuses a token signed by another key, but still shows what it claims", async () => {
    const r = await verifyLaunch(platform, await token(claims(), { key: otherKey }), "n-1", keys);
    assert.equal(r.verified, false);
    assert.deepEqual(failed(r), ["signature"]);
    assert.equal(r.claims?.sub, "user-42");
  });

  test("refuses another issuer, another audience, or an expired token", async () => {
    for (const opts of [{ iss: "https://evil.example" }, { aud: "another-tool" }, { exp: Math.floor(Date.now() / 1000) - 600 }]) {
      const r = await verifyLaunch(platform, await token(claims(), opts), "n-1", keys);
      assert.deepEqual(failed(r), ["signature"], JSON.stringify(opts));
    }
  });

  test("with several audiences, requires azp to name this tool", async () => {
    const aud = [platform.clientId, "another-tool"];
    assert.deepEqual(failed(await verifyLaunch(platform, await token(claims(), { aud }), "n-1", keys)), ["azp"]);
    const r = await verifyLaunch(platform, await token(claims({ azp: platform.clientId }), { aud }), "n-1", keys);
    assert.equal(r.verified, true);
  });

  test("refuses a nonce that differs from the cookie, or no cookie at all", async () => {
    const t = await token();
    assert.deepEqual(failed(await verifyLaunch(platform, t, "n-other", keys)), ["nonce"]);
    const none = await verifyLaunch(platform, t, null, keys);
    assert.deepEqual(failed(none), ["nonce"]);
    assert.match(none.checks.find((c) => c.name === "nonce")!.detail, /no state cookie/);
  });

  test("refuses a deployment not in the list, and accepts any when the list is empty", async () => {
    const t = await token(claims({ [`${CLAIM}deployment_id`]: "dep-9" }));
    assert.deepEqual(failed(await verifyLaunch(platform, t, "n-1", keys)), ["deployment_id"]);
    const any = await verifyLaunch({ ...platform, deploymentIds: [] }, t, "n-1", keys);
    assert.equal(any.verified, true);
    assert.match(any.checks.find((c) => c.name === "deployment_id")!.detail, /any is accepted/);
  });

  test("refuses the wrong LTI version or message type, and an anonymous launch", async () => {
    const t = await token(
      claims({ [`${CLAIM}version`]: "1.1", [`${CLAIM}message_type`]: "LtiSubmissionReviewRequest", sub: undefined }),
    );
    assert.deepEqual(failed(await verifyLaunch(platform, t, "n-1", keys)), ["version", "message_type", "sub"]);
  });
});
