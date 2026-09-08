/** Edits or removes a sign-in domain. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteAllowedDomain,
  domainInputSchema,
  STATUS_FOR,
  updateAllowedDomain,
} from "@/lib/allowed-domains";
import { canManageSettings } from "@/lib/roles";

async function actor() {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" as const, status: 401 };
  if (!canManageSettings(session.user.siteRole)) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { actor: { id: session.user.id, email: session.user.email } };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await actor();
  if (!who.actor) {
    return NextResponse.json({ error: who.error }, { status: who.status });
  }

  const parsed = domainInputSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateAllowedDomain(who.actor, id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await actor();
  if (!who.actor) {
    return NextResponse.json({ error: who.error }, { status: who.status });
  }

  const { id } = await params;
  const result = await deleteAllowedDomain(who.actor, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}
