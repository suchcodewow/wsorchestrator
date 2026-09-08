/** Re-runs a failed provision. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Viewer } from "@/lib/runs";
import { retryRun, type RetryRunError } from "@/lib/trigger";

async function viewer(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, role: session.user.siteRole };
}

const STATUS_FOR: Record<RetryRunError, number> = {
  not_found: 404,
  not_retryable: 409,
  trigger_failed: 502,
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await viewer();
  if (!who) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await retryRun(id, who);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ ok: true });
}
