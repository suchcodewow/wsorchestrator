/** Replaces or removes one org secret. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import {
  deleteOrgSecret,
  readOrgSecretForm,
  STATUS_FOR,
  updateOrgSecret,
} from "@/lib/harness-org-secrets";
import { audited } from "@/lib/audit";

export const PATCH = audited(async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireAdministrator(req);
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
    null,
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
});

export const DELETE = audited(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdministrator(req);
  if (error) return error;

  const { id } = await params;
  if (!(await deleteOrgSecret(null, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ id, status: "removed" });
});
