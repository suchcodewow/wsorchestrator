/** Adds a sign-in domain. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  addAllowedDomain,
  domainInputSchema,
  STATUS_FOR,
} from "@/lib/allowed-domains";
import { canManageSettings } from "@/lib/roles";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageSettings(session.user.siteRole)) {
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
