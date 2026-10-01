/**
 * Authenticates an API request from either a session or a personal access
 * token. Every route goes through `requireCaller` (or one of the shorthands
 * below) unless it is deliberately session-only; those call `auth()` directly
 * and are listed in docs/api.md.
 */

import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveToken, type TokenBearer } from "@/lib/api-tokens";
import {
  canManageEvalsSettings,
  canManageSettings,
  type Access,
} from "@/lib/roles";

export type Caller = TokenBearer;

export type CallerGate =
  | { error: NextResponse; user: null }
  | { error: null; user: Caller };

export async function sessionOrToken(req: Request): Promise<Caller | null> {
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

/**
 * The caller, from a session or a token: 401 if neither, 403 if `allowed`
 * says no. Without `allowed`, any signed-in account passes.
 */
export async function requireCaller(
  req: Request,
  allowed?: (access: Access) => boolean,
): Promise<CallerGate> {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      user: null,
    };
  }
  if (allowed && !allowed(caller.access)) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
      user: null,
    };
  }
  return { error: null, user: caller };
}

/** Any signed-in account, for the things that are only ever their own. */
export function requireUser(req: Request) {
  return requireCaller(req);
}

export function requireAdministrator(req: Request) {
  return requireCaller(req, canManageSettings);
}

/** An eVals administrator, for eVals settings. */
export function requireEvalsAdministrator(req: Request) {
  return requireCaller(req, canManageEvalsSettings);
}
