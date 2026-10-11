/** Gives a test account a fresh start (`resetTestAccount`). Session-only, as making one is. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { audited } from "@/lib/audit";
import { canImpersonate } from "@/lib/roles";
import { resetTestAccount, type ResetTestAccountError } from "@/lib/test-accounts";

const STATUS_FOR: Record<ResetTestAccountError, number> = {
  production: 409,
  forbidden: 403,
  not_found: 404,
  owns_events: 409,
};

export const POST = audited(async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canImpersonate(session.user.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result = await resetTestAccount(session.user, (await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  return NextResponse.json({ ok: true });
});
