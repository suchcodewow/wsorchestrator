/** Notes that you opened a Mimir item, which is what makes it viewed. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { recordVisit } from "@/lib/mimir/progress";

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  if (!(await recordVisit(user.id, (await params).id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
