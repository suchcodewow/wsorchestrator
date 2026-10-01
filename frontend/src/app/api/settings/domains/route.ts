/**
 * The sign-in domains, and adding one. Reading takes a token; adding is
 * session-only, as it decides who can sign in at all.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireCaller } from "@/lib/api-auth";
import {
  addAllowedDomain,
  domainInputSchema,
  envAllowedDomains,
  listAllowedDomains,
  STATUS_FOR,
} from "@/lib/allowed-domains";
import { canManageSignInDomains } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageSignInDomains);
  if (error) return error;

  return NextResponse.json({
    domains: await listAllowedDomains(),
    fromEnvironment: envAllowedDomains(),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageSignInDomains(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = domainInputSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addAllowedDomain(
    { id: session.user.id, email: session.user.email },
    parsed.data,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}
