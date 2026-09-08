/** Replaces or removes one org secret. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import {
  deleteOrgSecret,
  readOrgSecretForm,
  STATUS_FOR,
  updateOrgSecret,
} from "@/lib/harness-org-secrets";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireAdministrator();
  if (error) return error;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "malformed" }, { status: 400 });

  const parsed = await readOrgSecretForm(form);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: STATUS_FOR[parsed.error] },
    );
  }

  const { id } = await params;
  const result = await updateOrgSecret(
    id,
    parsed.identifier,
    parsed.input,
    user.id,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ secret: result.secret });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdministrator();
  if (error) return error;

  const { id } = await params;
  if (!(await deleteOrgSecret(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ id, status: "removed" });
}
