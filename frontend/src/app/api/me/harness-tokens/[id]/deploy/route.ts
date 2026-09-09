/** Deploys the picked content into a Harness organization. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { deployContent } from "@/lib/harness-deploy";
import { STATUS_FOR } from "@/lib/harness-deploy-errors";
import type { DeploySelection } from "@/lib/harness-deploy-selection";

export const maxDuration = 300;

type Body = {
  org?: unknown;
  official?: unknown;
  mySecrets?: unknown;
  myTemplates?: unknown;
};

/** Everything ticked is optional to send, and anything missing is off. */
function selectionOf(body: Body): DeploySelection {
  return {
    official: body.official === true,
    mySecrets: body.mySecrets === true,
    myTemplates: Array.isArray(body.myTemplates)
      ? body.myTemplates.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, user } = await requireAdministrator();
  if (error) return error;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (typeof body?.org !== "string") {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const { id } = await params;
  const result = await deployContent(user.id, id, body.org, selectionOf(body));
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ report: result.report });
}
