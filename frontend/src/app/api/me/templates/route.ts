/** Where this account's own deploys may read Harness templates from. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { STATUS_FOR } from "@/lib/harness-template-errors";
import { listTemplateSources, saveTemplateSource } from "@/lib/harness-templates";

export async function GET() {
  const { error, user } = await requireUser();
  if (error) return error;
  return NextResponse.json({ sources: await listTemplateSources(user.id) });
}

export async function POST(req: Request) {
  const { error, user } = await requireUser();
  if (error) return error;

  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
    org?: unknown;
    project?: unknown;
  } | null;

  if (typeof body?.token !== "string" || typeof body.org !== "string") {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }

  const result = await saveTemplateSource(
    user.id,
    body.token,
    body.org,
    typeof body.project === "string" ? body.project : null,
    user.id,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ source: result.source }, { status: 201 });
}
