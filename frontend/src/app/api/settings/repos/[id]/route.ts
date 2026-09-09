/** Edits or forgets one repository the workshops import. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { deleteRepo, STATUS_FOR, updateRepo } from "@/lib/harness-repos";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdministrator();
  if (error) return error;

  const body = (await req.json().catch(() => null)) as {
    url?: unknown;
    identifier?: unknown;
    scope?: unknown;
  } | null;
  if (body === null) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateRepo(id, body);
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
  const { error } = await requireAdministrator();
  if (error) return error;

  const { id } = await params;
  const result = await deleteRepo(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}
