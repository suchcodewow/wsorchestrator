/** The GitHub repositories every workshop imports into Harness. */

import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/api-auth";
import { addRepo, listRepos, STATUS_FOR } from "@/lib/harness-repos";

export async function GET() {
  const { error } = await requireAdministrator();
  if (error) return error;
  return NextResponse.json({ repos: await listRepos() });
}

export async function POST(req: Request) {
  const { error, user } = await requireAdministrator();
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
}
