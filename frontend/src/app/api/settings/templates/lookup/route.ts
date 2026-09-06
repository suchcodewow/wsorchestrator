import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { listHarnessOrgs, listHarnessProjects } from "@/lib/harness-platform";
import { STATUS_FOR } from "@/lib/harness-template-errors";

/**
 * What a pasted token can see: its organizations, or the projects in one of
 * them. Administrators only.
 *
 * A POST, and not because anything is written — the token is in the body, and a
 * credential does not belong in a query string that lands in every access log
 * and in the browser's history. Nothing is stored: this is the lookup that fills
 * the two pickers, and the token is only saved once a source is.
 *
 * One route for both because it is one question asked at two depths, and the
 * client's second call differs from its first by a single field. `org` present
 * means "the projects in this org"; absent means "the organizations".
 */
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
      // Harness's own message, passed through: it names the reason a token was
      // refused — expired versus revoked — which nothing here can infer.
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ scopes: result.scopes });
}
