import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import {
  createOrgSecret,
  listOrgSecrets,
  readOrgSecretForm,
  STATUS_FOR,
} from "@/lib/harness-org-secrets";

/**
 * The secrets every workshop org gets. Administrators only — see
 * `requireAdministrator`, which is session-only on purpose: these rows decide
 * what credentials land in every workshop Harness organization the deployment
 * builds.
 *
 * `multipart/form-data` for both the inline and the uploaded shape. The parsing
 * is in `readOrgSecretForm`, where the reason lives.
 */
export async function GET() {
  const { error } = await requireAdministrator();
  if (error) return error;
  return NextResponse.json({ secrets: await listOrgSecrets() });
}

export async function POST(req: Request) {
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

  const result = await createOrgSecret(parsed.identifier, parsed.input, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ secret: result.secret }, { status: 201 });
}
