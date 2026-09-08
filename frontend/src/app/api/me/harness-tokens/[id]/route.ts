/** Re-checks or removes one saved Harness token. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteHarnessToken, recheckHarnessToken } from "@/lib/harness-tokens";
import { STATUS_FOR } from "@/lib/harness-token-errors";

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
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id, status: "removed", scrub });
}
