import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveToken, type TokenBearer } from "@/lib/api-tokens";
import { canManageSettings } from "@/lib/roles";

/**
 * Authenticate a request from either a browser session or a bundle token.
 *
 * Deliberately not a drop-in replacement for `auth()`. Only the component
 * endpoints call this, and that restriction is the security boundary: a token
 * is a long-lived string pasted into an environment variable on a machine this
 * app knows nothing about, held by the one role that may belong to someone
 * outside the team. If it leaked it must not be able to schedule a workshop,
 * read an attendee roster, change a site setting, or run SQL — so the routes
 * that do those things keep calling `auth()` and no token reaches them.
 *
 * The session is tried first. Somebody signed in *and* holding a token is
 * ordinarily the same person, but the session is the credential they can see
 * and revoke from the browser, so it wins.
 */
export async function sessionOrToken(
  req: Request,
): Promise<TokenBearer | null> {
  const session = await auth();
  if (session?.user) {
    return {
      id: session.user.id,
      siteRole: session.user.siteRole,
      email: session.user.email ?? null,
    };
  }

  const header = req.headers.get("authorization");
  if (!header) return null;

  // `Bearer <token>`, case-insensitively — plenty of clients send `bearer`.
  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;

  return resolveToken(match[1]!);
}

/**
 * The gate every site-settings route shares: signed in, and an administrator.
 *
 * Session only, and pointedly not `sessionOrToken` — see above. These routes
 * change what every workshop is built with and store credentials for another
 * system, which is the last thing a leaked bundle token should reach.
 *
 * Returns either the response to send or the user to act as, so a caller is one
 * `if` away from the work instead of restating the two checks and their two
 * different statuses.
 */
export async function requireAdministrator(): Promise<
  | { error: NextResponse; user: null }
  | { error: null; user: { id: string; email: string | null } }
> {
  const session = await auth();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      user: null,
    };
  }
  // Not 401: they are signed in, they just aren't allowed here.
  if (!canManageSettings(session.user.siteRole)) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
      user: null,
    };
  }
  return {
    error: null,
    user: { id: session.user.id, email: session.user.email ?? null },
  };
}
