/**
 * What a pasted token can see: its organizations, or one organization's
 * projects.
 */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { listHarnessOrgs, listHarnessProjects } from "@/lib/harness-platform";
import { STATUS_FOR } from "@/lib/harness-template-errors";

export async function POST(req: Request) {
  const { error } = await requireAdministrator();
  if (error) return error;

  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
    org?: unknown;
  } | null;

  if (typeof body?.token !== "string" || body.token.trim().length === 0) {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  const org = typeof body.org === "string" ? body.org.trim() : "";

  const result = org
    ? await listHarnessProjects(body.token, org)
    : await listHarnessOrgs(body.token);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ scopes: result.scopes });
}
