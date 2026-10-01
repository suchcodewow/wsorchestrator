/** A user's own saved Harness platform tokens. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { deployChoices } from "@/lib/harness-deploy-choices";
import { scrubWindowDays } from "@/lib/harness-scrub";
import { listHarnessTokens, saveHarnessToken } from "@/lib/harness-tokens";
import { secretsConfigured } from "@/lib/secret-box";
import { STATUS_FOR } from "@/lib/harness-token-errors";

export async function GET(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    tokens: await listHarnessTokens(caller.id),
    choices: await deployChoices(caller.id),
    configured: secretsConfigured(),
    scrubDays: scrubWindowDays(),
  });
}

export async function POST(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
  } | null;

  if (typeof body?.token !== "string") {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }

  const result = await saveHarnessToken(caller.id, body.token);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  return NextResponse.json({ token: result.token }, { status: 201 });
}
