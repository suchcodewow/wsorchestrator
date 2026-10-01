/** Re-checks or removes one saved Harness token. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { deleteHarnessToken, recheckHarnessToken } from "@/lib/harness-tokens";
import { STATUS_FOR } from "@/lib/harness-token-errors";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await recheckHarnessToken(caller.id, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ token: result.token });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { deleted, scrub } = await deleteHarnessToken(caller.id, id);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id, status: "removed", scrub });
}
