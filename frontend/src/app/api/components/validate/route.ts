import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canContributeComponents } from "@/lib/roles";
import { validateSet } from "@/lib/components/validate";

/**
 * Check a proposed set of components without storing or deploying anything.
 *
 * This is the contributor's fast loop: the bundle's `validate` script posts
 * here, Claude reads the issues, fixes the files, and posts again. Seconds per
 * iteration, no Harness call, nothing created.
 *
 * It answers only what one component can be judged on alone — see
 * `validateSet`. Cycles and dangling references need the whole catalog and are
 * checked by the runner when the sandbox run starts. Saying so in the response
 * matters: a contributor who reads "valid" here and then watches a run fail on
 * a cycle should have been told what this did and did not look at.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canContributeComponents(session.user.siteRole)) {
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
    // Not a disclaimer — the contributor needs to know a clean result here is
    // not a clean result overall, so that a later failure is expected rather
    // than baffling.
    note:
      "Per-component checks only: identifiers, kinds, scopes, and spec shape. " +
      "Dependency cycles and references to components that do not exist are " +
      "checked by the runner when a sandbox run starts.",
  });
}
