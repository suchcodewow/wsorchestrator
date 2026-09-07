import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { scrubDeployedSecrets } from "@/lib/harness-scrub";

/**
 * One Harness read and one write per secret, and a deploy leaves as many secrets
 * as Settings → Org Secrets holds. Nowhere near a deploy's length, but past the
 * platform default for a handful of them on a slow cluster.
 */
export const maxDuration = 120;

/**
 * Scrub the site's credentials out of what this token deployed, now.
 *
 * The manual counterpart to the scheduled sweep in `runner/src/scrub.ts`, and the
 * reason it exists is that the sweep can fail quietly — the job stops running,
 * the token is revoked, and the page goes on promising a scrub that nothing is
 * going to perform. This does the work in this request, so pressing the button is
 * an answer rather than another promise.
 *
 * `requireAdministrator` for the same reason the deploy has it: these rows exist
 * because somebody deployed the site's org secrets, and both ends of that are
 * administrator business. The token is scoped to the caller inside
 * `scrubDeployedSecrets`, so somebody else's is a 404.
 *
 * A 200 does not mean everything was scrubbed. Secrets the account's owner has
 * since edited are deliberately left alone, and anything Harness refused is
 * reported — `run.problems` is the part worth reading.
 */
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
