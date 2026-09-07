import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { deployContent } from "@/lib/harness-deploy";
import { STATUS_FOR } from "@/lib/harness-deploy-errors";

/**
 * A deploy makes one Harness call per entity, sequentially, and a source
 * organization with fifty templates in it is fifty fetches and fifty creates.
 * Well past the platform default, and the whole point of the request is that it
 * finishes rather than that it is quick.
 */
export const maxDuration = 300;

/**
 * Build a Harness organization from this site's settings, using one of the
 * caller's own saved tokens.
 *
 * Two gates, and they are not redundant. `requireAdministrator` is the *site*
 * one: this reads every value in Settings → Org Secrets and every token in
 * Settings → Templates, so it may only be reached by somebody already allowed to
 * see those pages — otherwise a token holder with no site privileges could
 * deploy the deployment's credentials into an organization they control and read
 * them there. The *Harness* one is inside `deployContent`, which asks Harness
 * whether the token still administers the account before it writes anything.
 *
 * The token is looked up by id and scoped to the caller, so somebody else's is a
 * 404 rather than a refusal that confirms it exists.
 *
 * A 200 does not mean everything worked. Once the organization is there the
 * response is always a report, and individual entities Harness refused are lines
 * in it — see `@/lib/harness-deploy`.
 */
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
      // Harness's own message passed through: it names the reason an
      // organization was refused, which nothing here could infer.
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ report: result.report });
}
