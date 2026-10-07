/**
 * Where Google's consent screen sends the browser back: trades the code for
 * the account's refresh token, stores it sealed, and returns to the Google
 * Meetings tab with how it went. Session-only, like `connect`.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordAudit, requestIp } from "@/lib/audit";
import { GOOGLE_STATE_COOKIE, googleRedirectUri, saveGoogleConnection } from "@/lib/evals/google-meetings";
import { exchangeCode, GOOGLE_MEETING_SCOPES, oauthClient } from "@/lib/google-calendar";
import { canManageEvalsSettings } from "@/lib/roles";
import { sealSecret } from "@/lib/secret-box";

const TAB = "/evals-settings/google-meetings";

function back(req: Request, google: string, extra: Record<string, string> = {}) {
  const base = process.env.AUTH_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  const res = NextResponse.redirect(`${base}${TAB}?${new URLSearchParams({ google, ...extra })}`);
  res.cookies.delete(GOOGLE_STATE_COOKIE);
  return res;
}

function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageEvalsSettings(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${GOOGLE_STATE_COOKIE}=`))
    ?.slice(GOOGLE_STATE_COOKIE.length + 1);
  if (!sameState(url.searchParams.get("state"), cookie)) return back(req, "expired");
  if (url.searchParams.get("error")) return back(req, "denied");

  const client = oauthClient();
  const code = url.searchParams.get("code");
  if (!client || !code) return back(req, "failed");

  const actor = { id: session.user.id, email: session.user.email ?? null, name: session.user.name };
  const audit = async (outcome: "succeeded" | "failed", summary: string, target: string | null, detail?: Record<string, unknown>) =>
    recordAudit({
      actor,
      via: "session",
      action: "evals.google-meetings.connect",
      summary,
      path: url.pathname,
      target,
      targetLabel: target,
      status: outcome === "succeeded" ? 200 : 400,
      outcome,
      detail: detail ?? null,
      ip: await requestIp(),
    });

  let account: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    account = await exchangeCode(client, code, googleRedirectUri(req));
  } catch (err) {
    await audit("failed", "Tried to connect the Google account for Google Meetings.", null, { error: (err as Error).message });
    return back(req, "failed");
  }

  const granted = new Set(account.scope.split(" "));
  if (!GOOGLE_MEETING_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.has(s))) {
    await audit("failed", "Connected a Google account without calendar access.", account.email, { scope: account.scope });
    return back(req, "scope");
  }

  const saved = await saveGoogleConnection(session.user.id, {
    email: account.email,
    refreshToken: sealSecret(account.refreshToken),
    scope: account.scope,
  });
  if (!saved.ok) {
    await audit("failed", "Tried to connect a different Google account while meetings have invites.", account.email, {
      error: saved.error,
      current: saved.current,
    });
    return back(req, "different_account", { current: saved.current });
  }

  await audit("succeeded", "Connected the Google account Google Meetings sends invites from.", account.email, {
    replaced: saved.replaced,
  });
  return back(req, "connected");
}
