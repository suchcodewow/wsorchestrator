/** Forgets a template source. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { deleteTemplateSource } from "@/lib/harness-templates";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdministrator();
  if (error) return error;

  const { id } = await params;
  if (!(await deleteTemplateSource(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ id, status: "removed" });
}
