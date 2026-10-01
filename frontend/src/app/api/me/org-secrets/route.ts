/** The secrets this account adds to every Harness organization it deploys. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import {
  createOrgSecret,
  listOrgSecrets,
  readOrgSecretForm,
  STATUS_FOR,
} from "@/lib/harness-org-secrets";
import { secretsConfigured } from "@/lib/secret-box";
import { audited } from "@/lib/audit";
import { ORG_SECRET_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  const { rows, page, hasMore } = await listOrgSecrets(
    user.id,
    parseListQuery(new URL(req.url).searchParams, ORG_SECRET_LIST),
  );
  return NextResponse.json({ secrets: rows, page, hasMore, configured: secretsConfigured() });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireUser(req);
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

  const result = await createOrgSecret(
    user.id,
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
  return NextResponse.json({ secret: result.secret }, { status: 201 });
});
