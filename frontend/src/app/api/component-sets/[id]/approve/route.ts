import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canPublishComponents } from "@/lib/roles";
import { approveComponentSet, setStatus } from "@/lib/components/catalog";

/**
 * Publish a reviewed set into the baseline, or send it back.
 *
 * This is the real gate. Everything before it is a contributor working in a
 * sandbox org that expires in two hours; past it, their components are deployed
 * into every workshop, and a pipeline template runs on a delegate inside a
 * workshop's cloud project. So it takes a manager, and it is the one step in
 * the loop that cannot be reached from the downloaded bundle.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Session-only, unlike every other component endpoint. Publishing is the one
  // step that deploys a contribution into every workshop, and the comment above
  // says it cannot be reached from the downloaded bundle — accepting a bearer
  // token here would quietly make that untrue. A manager approves from a
  // browser, having read what they are approving.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canPublishComponents(session.user.siteRole)) {
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
}
