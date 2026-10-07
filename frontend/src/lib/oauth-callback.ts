/**
 * One OAuth callback URL for every account the app connects, so each
 * environment registers a single redirect URI with each provider and no new
 * connection ever needs one: `{AUTH_URL}/api/auth/callback/google`.
 *
 * That is Auth.js's own sign-in callback, already on the Google OAuth client
 * for every environment. Auth.js cannot be moved off it: it always builds its
 * redirect URI as `{basePath}/callback/{provider}`, and its redirect proxy
 * only works across origins. So the other flows come to it instead. Theirs is
 * the only state that starts `wo.`, followed by the purpose and a nonce:
 * `wo.slack.<nonce>`. Auth.js's own state is an encrypted token, which
 * starts `eyJ`. The Auth.js route hands a `wo.` state to
 * `lib/oauth-purposes.ts` and everything else to Auth.js, so sign-in is
 * untouched.
 *
 * Slack registers the same URL under its app's Redirect URLs; the "google" in
 * the path is Auth.js's provider id and means nothing to Slack.
 */

import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const OAUTH_CALLBACK_PATH = "/api/auth/callback/google";

/** Ties a return to the browser that started it; scoped to the callback, for ten minutes. */
export const OAUTH_STATE_COOKIE = "oauth_connect_state";

const PREFIX = "wo.";

/** Every flow that returns through the shared callback; `lib/oauth-purposes.ts` says what each does. */
export const OAUTH_PURPOSES = ["slack", "google-meetings"] as const;
export type OAuthPurpose = (typeof OAUTH_PURPOSES)[number];

/** The app's own origin, from `AUTH_URL` where it is set, since a provider matches the redirect URI exactly. */
export function appBase(req: Request): string {
  return process.env.AUTH_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
}

/** The redirect URI every flow sends, on the authorize request and again on the code exchange. */
export function oauthRedirectUri(req: Request): string {
  return `${appBase(req)}${OAUTH_CALLBACK_PATH}`;
}

/** Whether a callback's state is one of ours rather than Auth.js's. */
export function isConnectState(state: string | null | undefined): state is string {
  return typeof state === "string" && state.startsWith(PREFIX);
}

/** The purpose a state names, or null for one that names none we know. */
export function purposeOf(state: string | null | undefined): OAuthPurpose | null {
  if (!isConnectState(state)) return null;
  const [purpose, nonce, ...rest] = state.slice(PREFIX.length).split(".");
  if (!nonce || rest.length) return null;
  return OAUTH_PURPOSES.includes(purpose as OAuthPurpose) ? (purpose as OAuthPurpose) : null;
}

/** Whether the state a provider returned is the one this browser was sent off with. */
export function stateMatches(state: string | null | undefined, cookie: string | null | undefined): boolean {
  if (!state || !cookie || state.length !== cookie.length) return false;
  return timingSafeEqual(Buffer.from(state), Buffer.from(cookie));
}

/**
 * Sends the browser to a provider's consent screen for `purpose`, with a fresh
 * state that the shared callback will route back here, and the cookie it is
 * checked against.
 */
export function startOAuth(req: Request, purpose: OAuthPurpose, authorizeUrl: (state: string) => string): NextResponse {
  const state = `${PREFIX}${purpose}.${randomBytes(24).toString("base64url")}`;
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: oauthRedirectUri(req).startsWith("https:"),
    sameSite: "lax",
    path: OAUTH_CALLBACK_PATH,
    maxAge: 10 * 60,
  });
  return res;
}
