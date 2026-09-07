import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteHarnessToken, recheckHarnessToken } from "@/lib/harness-tokens";
import { STATUS_FOR } from "@/lib/harness-token-errors";

/**
 * Re-check one saved token against Harness, and update what we know about it.
 *
 * A POST rather than a GET: it writes — the account name, the permissions, and
 * when it was last confirmed — and it makes a call to another system on the way.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await recheckHarnessToken(session.user.id, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ token: result.token });
}

/**
 * Forget a saved token. Scoped to the owner, so somebody else's is a 404.
 *
 * Scrubs whatever the token deployed on the way out — the last moment anything
 * can, since the credential goes with it. That makes this slower than a delete
 * looks: one Harness read and one write per secret it left behind.
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
  const { deleted, scrub } = await deleteHarnessToken(session.user.id, id);
  // Somebody else's token, one already gone, and one that never existed all
  // answer the same way — the endpoint does not confirm which ids are real.
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // A 200 with a warning rather than an error: the token is gone, which is what
  // was asked for, but a credential of this site's may still be sitting in
  // another account and this is the one moment somebody is looking.
  return NextResponse.json({ id, status: "removed", scrub });
}
