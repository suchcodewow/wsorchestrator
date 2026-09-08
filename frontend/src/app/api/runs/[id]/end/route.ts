/** Moves an event's end time to now, so it tears down normally. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { endRunNow, type EndRunError, type Viewer } from "@/lib/runs";

async function viewer(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, role: session.user.siteRole };
}

const STATUS_FOR: Record<EndRunError, number> = {
  not_found: 404,
  not_running: 409,
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
  const result = await endRunNow(id, who);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ run: result.run });
}
