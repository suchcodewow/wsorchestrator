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

/** Forget a saved token. Scoped to the owner, so somebody else's is a 404. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteHarnessToken(session.user.id, id);
  // Somebody else's token, one already gone, and one that never existed all
  // answer the same way — the endpoint does not confirm which ids are real.
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ id, status: "removed" });
}
