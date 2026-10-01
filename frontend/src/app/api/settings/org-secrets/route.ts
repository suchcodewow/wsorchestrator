/** The secrets every workshop's Harness organization gets. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import {
  createOrgSecret,
  listOrgSecrets,
  readOrgSecretForm,
  STATUS_FOR,
} from "@/lib/harness-org-secrets";
import { secretsConfigured } from "@/lib/secret-box";

export async function GET(req: Request) {
  const { error } = await requireAdministrator(req);
  if (error) return error;
  return NextResponse.json({
    secrets: await listOrgSecrets(null),
    configured: secretsConfigured(),
  });
}

export async function POST(req: Request) {
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

  const result = await createOrgSecret(null, parsed.identifier, parsed.input, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ secret: result.secret }, { status: 201 });
}
