/** Publishes a reviewed component set, or sends it back. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { canPublishComponents } from "@/lib/roles";
import { approveComponentSet, setStatus } from "@/lib/components/catalog";
import { audited } from "@/lib/audit";

export const POST = audited(async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canPublishComponents(caller.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    approve?: unknown;
    notes?: unknown;
  };
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : "";

  if (body.approve === false) {
    const moved = await setStatus(id, "submitted", "rejected", notes);
    if (!moved) {
      return NextResponse.json(
        { error: "not_reviewable", message: "only a submitted set can be reviewed" },
        { status: 409 },
      );
    }
    return NextResponse.json({ setId: id, status: "rejected" });
  }

  const approved = await approveComponentSet(id, notes);
  if (!approved) {
    return NextResponse.json(
      { error: "not_reviewable", message: "only a submitted set can be reviewed" },
      { status: 409 },
    );
  }

  return NextResponse.json({ setId: id, status: "approved" });
});
