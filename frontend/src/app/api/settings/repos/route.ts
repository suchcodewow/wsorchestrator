/** The GitHub repositories every workshop imports into Harness, a page at a time, and adding one. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { addRepo, listRepos, STATUS_FOR } from "@/lib/harness-repos";
import { audited } from "@/lib/audit";
import { REPO_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireAdministrator(req);
  if (error) return error;
  const { rows, page, hasMore } = await listRepos(parseListQuery(new URL(req.url).searchParams, REPO_LIST));
  return NextResponse.json({ repos: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireAdministrator(req);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as {
    url?: unknown;
    identifier?: unknown;
    scope?: unknown;
  } | null;
  if (body === null) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  const result = await addRepo(user.id, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
});
