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
import { noteCaller } from "@/lib/audit-context";
import {
  canManageEvalsSettings,
  canManageSettings,
  canRefreshCanaryWire,
  canSeeCanaryWire,
  canUseEvals,
  type Access,
} from "@/lib/roles";

export type Caller = TokenBearer;

export type CallerGate =
  | { error: NextResponse; user: null }
  | { error: null; user: Caller };

export async function sessionOrToken(req: Request): Promise<Caller | null> {
  const session = await auth();
  if (session?.user) {
    const caller = {
      id: session.user.id,
      access: session.user.access,
      email: session.user.email ?? null,
    };
    noteCaller({ ...caller, name: session.user.name ?? null }, "session");
    return caller;
  }

  const header = req.headers.get("authorization");
  if (!header) return null;

  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;

  const bearer = await resolveToken(match[1]!);
  if (bearer) noteCaller(bearer, "token");
  return bearer;
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

/** An Assessments Viewer or above, for what eVals shows. */
export function requireEvalsViewer(req: Request) {
  return requireCaller(req, canUseEvals);
}

/** An Assessments Administrator, for eVals settings. */
export function requireEvalsAdministrator(req: Request) {
  return requireCaller(req, canManageEvalsSettings);
}

/** A people manager or platform administrator, for Reporting → Canary Wire. */
export function requireCanaryWire(req: Request) {
  return requireCaller(req, canSeeCanaryWire);
}

/** A platform administrator, to start or step a Canary Wire pull by hand. */
export function requireCanaryWireRefresh(req: Request) {
  return requireCaller(req, canRefreshCanaryWire);
}
