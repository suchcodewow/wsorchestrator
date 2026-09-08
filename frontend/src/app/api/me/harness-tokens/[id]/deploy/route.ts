/** Deploys this site's content into a Harness organization. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { deployContent } from "@/lib/harness-deploy";
import { STATUS_FOR } from "@/lib/harness-deploy-errors";

export const maxDuration = 300;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireAdministrator();
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { org?: unknown } | null;
  if (typeof body?.org !== "string") {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const { id } = await params;
  const result = await deployContent(user.id, id, body.org);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ report: result.report });
}
