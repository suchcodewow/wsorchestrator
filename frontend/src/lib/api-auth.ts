/** Authenticates an API request from either a session or a bundle token. */

import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveToken, type TokenBearer } from "@/lib/api-tokens";
import {
  canManageEvalsSettings,
  canManageSettings,
  type Access,
} from "@/lib/roles";

export async function sessionOrToken(
  req: Request,
): Promise<TokenBearer | null> {
  const session = await auth();
  if (session?.user) {
    return {
      id: session.user.id,
      access: session.user.access,
      email: session.user.email ?? null,
    };
  }

  const header = req.headers.get("authorization");
  if (!header) return null;

  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;

  return resolveToken(match[1]!);
}

/** Any signed-in account, for the things that are only ever their own. */
export async function requireUser(): Promise<
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
  return {
    error: null,
    user: { id: session.user.id, email: session.user.email ?? null },
  };
}

export function requireAdministrator() {
  return requireAccess(canManageSettings);
}

/** An eVals administrator, for eVals settings. */
export function requireEvalsAdministrator() {
  return requireAccess(canManageEvalsSettings);
}

async function requireAccess(
  allowed: (access: Access) => boolean,
): Promise<
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
  if (!allowed(session.user.access)) {
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
