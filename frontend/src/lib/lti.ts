/**
 * An LTI 1.3 launch from Mindtickle, as a tool: the third-party initiated
 * login (`/api/lti/login`) and the signed launch it ends in
 * (`/api/lti/launch`). For now the launch only verifies the platform's
 * id_token and reports what it carries; it signs nobody in.
 *
 * The flow, from the LTI 1.3 core and security framework specs:
 *  1. Mindtickle sends the browser to the login URL with `iss`,
 *     `login_hint` and `target_link_uri`.
 *  2. We send it on to Mindtickle's authorization endpoint with a fresh
 *     `state` and `nonce`, the nonce kept in a cookie named after the state.
 *  3. Mindtickle posts a signed id_token and the state back to the launch URL.
 *  4. We check the token's signature against Mindtickle's JWKS, its issuer,
 *     audience and lifetime, the nonce against the cookie, and the LTI claims.
 *
 * Both requests happen inside Mindtickle's iframe, where this app is a third
 * party, so the cookie is `SameSite=None; Secure; Partitioned`: a `Lax`
 * cookie is not sent on the cross-site POST in step 3, and an unpartitioned
 * one is blocked outright by Safari.
 */

import "server-only";

import { randomBytes } from "node:crypto";
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

export const LTI_LOGIN_PATH = "/api/lti/login";
export const LTI_LAUNCH_PATH = "/api/lti/launch";

/** The nonce for one login, under a name that carries its state; ten minutes, the launch path only. */
export const LTI_STATE_COOKIE_PREFIX = "lti_state_";
export const LTI_STATE_MAX_AGE = 10 * 60;

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const MESSAGE_TYPES = ["LtiResourceLinkRequest", "LtiDeepLinkingRequest"];

/** What Mindtickle gave us when the tool was registered. */
export type LtiPlatform = {
  issuer: string;
  clientId: string;
  /** Deployments to accept; empty accepts any, which the launch page says. */
  deploymentIds: string[];
  authUrl: string;
  jwksUrl: string;
};

/**
 * The platform from the environment, or null when any part is unset. None of
 * it is secret: the platform's keys are public, and the tool signs nothing yet.
 * Values are trimmed, since one pasted into a setting can carry a newline.
 */
export function ltiPlatform(): LtiPlatform | null {
  const env = (name: string) => (process.env[name] ?? "").trim();
  const issuer = env("LTI_ISSUER");
  const clientId = env("LTI_CLIENT_ID");
  const authUrl = env("LTI_AUTH_URL");
  const jwksUrl = env("LTI_JWKS_URL");
  if (!issuer || !clientId || !authUrl || !jwksUrl) return null;
  const deploymentIds = env("LTI_DEPLOYMENT_IDS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { issuer, clientId, deploymentIds, authUrl, jwksUrl };
}

/** The login initiation request's parameters, from a GET's query or a POST's form. */
export type LoginParams = {
  iss?: string;
  login_hint?: string;
  target_link_uri?: string;
  lti_message_hint?: string;
  client_id?: string;
  lti_deployment_id?: string;
};

/** Why a login initiation cannot go on, or null when it can. */
export function loginProblem(platform: LtiPlatform, p: LoginParams): string | null {
  if (!p.iss || !p.login_hint || !p.target_link_uri) return "missing_parameter";
  if (p.iss !== platform.issuer) return "unknown_issuer";
  if (p.client_id && p.client_id !== platform.clientId) return "unknown_client";
  return null;
}

/** A fresh state and nonce for one login. */
export function newLoginState(): { state: string; nonce: string } {
  return {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
  };
}

/** Step 2: Mindtickle's authorization endpoint, asked to post an id_token back to `redirectUri`. */
export function authorizeUrl(
  platform: LtiPlatform,
  p: LoginParams,
  redirectUri: string,
  login: { state: string; nonce: string },
): string {
  const url = new URL(platform.authUrl);
  const q = url.searchParams;
  q.set("scope", "openid");
  q.set("response_type", "id_token");
  q.set("response_mode", "form_post");
  q.set("prompt", "none");
  q.set("client_id", platform.clientId);
  q.set("redirect_uri", redirectUri);
  q.set("login_hint", p.login_hint!);
  q.set("state", login.state);
  q.set("nonce", login.nonce);
  if (p.lti_message_hint) q.set("lti_message_hint", p.lti_message_hint);
  return url.toString();
}

export type Check = { name: string; ok: boolean; detail: string };

export type LaunchResult = {
  /** Every check passed: the claims are Mindtickle's, for this tool, and for this browser. */
  verified: boolean;
  checks: Check[];
  header: Record<string, unknown> | null;
  /** Once the signature fails these are only what the token says, unchecked. */
  claims: JWTPayload | null;
};

// One key set per URL for the life of the process: jose caches the keys and
// refetches when a token names a key it has not seen.
const keySets = new Map<string, JWTVerifyGetKey>();

function remoteKeys(jwksUrl: string): JWTVerifyGetKey {
  let keys = keySets.get(jwksUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(jwksUrl));
    keySets.set(jwksUrl, keys);
  }
  return keys;
}

function why(err: unknown): string {
  if (err instanceof errors.JOSEError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Step 4: everything a tool must check before it believes a launch.
 * `nonce` is the cookie's value, or null when the browser sent none (which is
 * itself worth knowing: it means cookies do not survive in the iframe).
 */
export async function verifyLaunch(
  platform: LtiPlatform,
  idToken: string,
  nonce: string | null,
  keys: JWTVerifyGetKey = remoteKeys(platform.jwksUrl),
): Promise<LaunchResult> {
  const checks: Check[] = [];
  let header: Record<string, unknown> | null = null;
  let claims: JWTPayload | null = null;

  try {
    header = decodeProtectedHeader(idToken) as Record<string, unknown>;
    claims = decodeJwt(idToken);
  } catch (err) {
    checks.push({ name: "token", ok: false, detail: `not a JWT: ${why(err)}` });
    return { verified: false, checks, header, claims };
  }

  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      issuer: platform.issuer,
      audience: platform.clientId,
      clockTolerance: 60,
    });
    claims = payload;
    checks.push({
      name: "signature",
      ok: true,
      detail: `RS256, key ${String(header.kid ?? "(no kid)")}; issuer, audience and lifetime match`,
    });
  } catch (err) {
    checks.push({ name: "signature", ok: false, detail: why(err) });
    return { verified: false, checks, header, claims };
  }

  // With several audiences, the authorized party must be us (core spec 5.1.3).
  const aud = claims.aud;
  const azp = claims.azp as string | undefined;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (azp !== undefined || audiences.length > 1) {
    checks.push({
      name: "azp",
      ok: azp === platform.clientId,
      detail: azp === undefined ? "several audiences and no azp" : `azp is ${azp}`,
    });
  }

  checks.push(
    nonce === null
      ? { name: "nonce", ok: false, detail: "no state cookie came back with the launch" }
      : { name: "nonce", ok: claims.nonce === nonce, detail: claims.nonce === nonce ? "matches the state cookie" : "differs from the state cookie" },
  );

  const deployment = claims[`${CLAIM}deployment_id`];
  checks.push(
    typeof deployment !== "string" || !deployment
      ? { name: "deployment_id", ok: false, detail: "missing" }
      : platform.deploymentIds.length === 0
        ? { name: "deployment_id", ok: true, detail: `${deployment} (any is accepted: LTI_DEPLOYMENT_IDS is unset)` }
        : {
            name: "deployment_id",
            ok: platform.deploymentIds.includes(deployment),
            detail: deployment,
          },
  );

  const version = claims[`${CLAIM}version`];
  checks.push({ name: "version", ok: version === "1.3.0", detail: String(version ?? "missing") });

  const type = claims[`${CLAIM}message_type`];
  checks.push({
    name: "message_type",
    ok: typeof type === "string" && MESSAGE_TYPES.includes(type),
    detail: String(type ?? "missing"),
  });

  if (claims.sub === undefined || claims.sub === "") {
    checks.push({ name: "sub", ok: false, detail: "missing: an anonymous launch identifies nobody" });
  }

  return { verified: checks.every((c) => c.ok), checks, header, claims };
}
