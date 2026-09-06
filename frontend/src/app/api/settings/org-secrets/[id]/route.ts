import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import {
  deleteOrgSecret,
  readOrgSecretForm,
  STATUS_FOR,
  updateOrgSecret,
} from "@/lib/harness-org-secrets";

/**
 * Replace a secret's value — and, with it, its identifier and whether it is
 * inline or a file. A rotation is a new value under the same name, which is the
 * same request as a correction.
 *
 * A PUT would be the tidier verb for "here is the whole row again", but there is
 * no way to send *part* of one: the value is required, because the old value can
 * never be read back to leave it alone. PATCH is what the rest of this app uses
 * for an edit form, and the shape follows that.
 */
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

/**
 * Forget a secret. Only here: the copies already created in live workshop orgs
 * stay until those orgs are torn down — see `deleteOrgSecret`.
 */
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
