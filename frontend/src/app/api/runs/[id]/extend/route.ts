import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { extendRun, type ExtendRunError, type Viewer } from "@/lib/runs";

/** The signed-in viewer, or null. */
async function viewer(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, role: session.user.siteRole };
}

const STATUS_FOR: Record<ExtendRunError, number> = {
  not_found: 404,
  // The event is tearing down or already gone; there is nothing to extend.
  not_extendable: 409,
};

/** Add one day to an event's lifetime. Owner, or a manager and above. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const who = await viewer();
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
