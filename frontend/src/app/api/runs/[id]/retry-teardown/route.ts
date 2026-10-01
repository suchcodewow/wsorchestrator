/** Restarts a teardown that gave up. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import {
  retryTeardown,
  type RetryTeardownError,
  type Viewer,
} from "@/lib/runs";
import { audited } from "@/lib/audit";

async function viewer(req: Request): Promise<Viewer | null> {
  const caller = await sessionOrToken(req);
  if (!caller) return null;
  return { id: caller.id, access: caller.access };
}

const STATUS_FOR: Record<RetryTeardownError, number> = {
  not_found: 404,
  not_retryable: 409,
};

export const POST = audited(async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await viewer(req);
  if (!who) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await retryTeardown(id, who);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
});
