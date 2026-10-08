/**
 * Viewing the app as an employee, for platform administrators. Session only:
 * it changes what this browser's session is, which a token does not have.
 * See `src/lib/impersonation.ts`.
 */

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  impersonationRefusal,
  impersonationTarget,
  setImpersonation,
} from "@/lib/impersonation";
import { canImpersonate } from "@/lib/roles";

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/** Who is signed in, and whom they are viewing the app as, if anyone. */
function state(session: Session) {
  if (!session.impersonator) return { impersonating: null, impersonator: null };
  const { id, email, name } = session.user;
  return {
    impersonating: { id, email: email ?? null, name: name ?? null },
    impersonator: session.impersonator,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return unauthorized();
  return NextResponse.json(state(session));
}

export const POST = audited(async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  // Switching straight from one person to another is still the administrator asking.
  const admin = session.impersonator ?? session.user;
  if (!session.impersonator && !canImpersonate(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const target = await impersonationTarget(email);
  noteAudit({ target: target?.email ?? email.toLowerCase(), targetLabel: target?.name ?? undefined });
  const refused = impersonationRefusal(admin, target);
  if (refused) {
    return NextResponse.json({ error: refused }, { status: refused === "not_found" ? 404 : 409 });
  }

  if (!(await setImpersonation(admin.id, target!.email))) {
    return NextResponse.json({ error: "no_session" }, { status: 409 });
  }
  return NextResponse.json({
    impersonating: { id: target!.id, email: target!.email, name: target!.name },
    impersonator: { id: admin.id, email: admin.email ?? null, name: admin.name ?? null },
  });
});

export const DELETE = audited(async function DELETE() {
  const session = await auth();
  if (!session?.user) return unauthorized();
  if (!session.impersonator) return NextResponse.json(state(session));

  noteAudit({ target: session.user.email ?? undefined, targetLabel: session.user.name ?? undefined });
  await setImpersonation(session.impersonator.id, null);
  return NextResponse.json({ impersonating: null, impersonator: null });
});
