/** Checks a proposed set of components without storing anything. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { canContributeComponents } from "@/lib/roles";
import { validateSet } from "@/lib/components/validate";

export async function POST(req: Request) {
  const viewer = await sessionOrToken(req);
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(viewer.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    components?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { issues, valid } = validateSet(body.components);

  return NextResponse.json({
    ok: issues.length === 0,
    checked: Array.isArray(body.components) ? body.components.length : 0,
    accepted: valid.length,
    issues,
    note:
      "Per-component checks only: identifiers, kinds, scopes, and spec shape. " +
      "Dependency cycles and references to components that do not exist are " +
      "checked by the runner when a sandbox run starts.",
  });
}
