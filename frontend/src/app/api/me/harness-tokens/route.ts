import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listHarnessTokens, saveHarnessToken } from "@/lib/harness-tokens";
import { STATUS_FOR } from "@/lib/harness-token-errors";

/**
 * A user's own saved Harness platform tokens.
 *
 * Session-only, and pointedly not `sessionOrToken`: these rows are credentials
 * for another system, recoverable by design. An app token that leaked must not be
 * able to add one, list them, or trigger a check — so nothing here accepts one.
 *
 * Every signed-in account may use this, whatever their role. A Harness token
 * grants exactly what Harness already granted its owner; storing one here adds
 * no access to this app and none to Harness, so there is nothing to gate.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    tokens: await listHarnessTokens(session.user.id),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The token is the entire request. Everything else on the row — the account,
  // its name, the principal, the permissions — is discovered from Harness during
  // the check, so there is nothing else to accept and nothing to validate.
  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
  } | null;

  if (typeof body?.token !== "string") {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }

  const result = await saveHarnessToken(session.user.id, body.token);

  if (!result.ok) {
    return NextResponse.json(
      // `detail` is Harness's own message, passed through so a refusal says what
      // Harness said rather than only that something was refused.
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ token: result.token }, { status: 201 });
}
