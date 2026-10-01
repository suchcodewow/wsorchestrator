/** Adds a day to an event's lifetime. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { extendRun, type ExtendRunError, type Viewer } from "@/lib/runs";

async function viewer(req: Request): Promise<Viewer | null> {
  const caller = await sessionOrToken(req);
  if (!caller) return null;
  return { id: caller.id, access: caller.access };
}

const STATUS_FOR: Record<ExtendRunError, number> = {
  not_found: 404,
  not_extendable: 409,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await viewer(req);
  if (!who) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await extendRun(id, who);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ run: result.run });
}
