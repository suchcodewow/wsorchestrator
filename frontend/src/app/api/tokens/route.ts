/** Personal access tokens for the contributor bundle's scripts. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTokens, mintToken } from "@/lib/api-tokens";
import { MAX_TOKENS_PER_USER, TOKEN_NAME_MAX } from "@/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tokens: await listTokens(session.user.id) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name =
    typeof body?.name === "string" ? body.name.slice(0, TOKEN_NAME_MAX) : "";

  const result = await mintToken(session.user.id, name);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message:
          result.error === "too_many"
            ? `Revoke one of your ${MAX_TOKENS_PER_USER} active tokens before creating another.`
            : "A token needs a name.",
      },
      { status: result.error === "too_many" ? 409 : 400 },
    );
  }

  return NextResponse.json({ token: result.token }, { status: 201 });
}
