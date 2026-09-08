/** Takes this site's secret values back out of what a token deployed. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { scrubDeployedSecrets } from "@/lib/harness-scrub";

export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireAdministrator();
  if (error) return error;

  const { id } = await params;
  const result = await scrubDeployedSecrets(user.id, id);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }

  return NextResponse.json({ run: result });
}
