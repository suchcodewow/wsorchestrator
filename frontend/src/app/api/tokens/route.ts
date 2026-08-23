import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTokens, mintToken } from "@/lib/api-tokens";
import { MAX_TOKENS_PER_USER, TOKEN_NAME_MAX } from "@/db/schema";

/**
 * Personal access tokens for the contributor bundle's scripts.
 *
 * Session-only, deliberately: a token must never be able to mint another. That
 * would turn a single leak into a credential that renews itself past any expiry
 * and survives revoking the one that leaked. Issuing one takes a browser.
 *
 * Any signed-in account may hold them. Contributing components is the floor
 * permission, not a privilege — what a token can reach is decided by
 * `sessionOrToken`, which accepts it on the component endpoints and nowhere
 * else.
 */
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
            ? `You already have ${MAX_TOKENS_PER_USER} active tokens. Revoke one first.`
            : "A token needs a name.",
      },
      { status: result.error === "too_many" ? 409 : 400 },
    );
  }

  // The one and only time the secret half is returned. The client shows it
  // once and cannot ask for it again, because nothing stores it.
  return NextResponse.json({ token: result.token }, { status: 201 });
}
