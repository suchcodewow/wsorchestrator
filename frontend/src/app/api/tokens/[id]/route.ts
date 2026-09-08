/** Revokes one of your own tokens. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { revokeToken } from "@/lib/api-tokens";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const revoked = await revokeToken(session.user.id, id);
  if (!revoked) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ id, status: "revoked" });
}
