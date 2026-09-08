/** Forgets one of this account's own template sources. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { deleteTemplateSource } from "@/lib/harness-templates";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireUser();
  if (error) return error;

  const { id } = await params;
  if (!(await deleteTemplateSource(user.id, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ id, status: "removed" });
}
