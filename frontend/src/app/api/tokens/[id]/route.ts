import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { revokeToken } from "@/lib/api-tokens";

/**
 * Revoke one of your own tokens. Session-only for the same reason minting is:
 * a leaked token must not be able to revoke the tokens you would use to
 * recover.
 */
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
  // A token belonging to somebody else, already revoked, or never real all
  // answer the same way — the endpoint does not confirm which ids exist.
  if (!revoked) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ id, status: "revoked" });
}
