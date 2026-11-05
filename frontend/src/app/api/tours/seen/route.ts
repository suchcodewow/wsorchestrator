/** Recording that the caller finished or skipped a version of a tour, so it does not play for them again; and forgetting all of it. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { markSeenSchema, markTourSeen, resetToursSeen } from "@/lib/tours/tours";

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = markSeenSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  noteAudit({ target: parsed.data.tourId, detail: { version: parsed.data.version } });

  if (!(await markTourSeen(user.id, parsed.data.tourId, parsed.data.version))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const reset = await resetToursSeen(user.id);
  noteAudit({ target: user.id, detail: { reset } });
  return NextResponse.json({ ok: true, reset });
});
