/** Your Mimir progress: how far you are overall and on each item, where to carry on from, and starting over. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { MIMIR_PROGRESS_LIST } from "@/lib/list-specs";
import { isMimirKind } from "@/lib/mimir/kinds";
import { listProgress, progressSummary, resetProgress, resumePoint } from "@/lib/mimir/progress";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const kind = params.get("kind") ?? undefined;
  if (kind !== undefined && !isMimirKind(kind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  const [{ rows, page, hasMore }, summary, resume] = await Promise.all([
    listProgress(user.id, parseListQuery(params, MIMIR_PROGRESS_LIST), kind),
    progressSummary(user.id),
    resumePoint(user.id),
  ]);
  return NextResponse.json({ summary, resume, items: rows, page, hasMore });
}

export const DELETE = audited(async function DELETE(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const cleared = await resetProgress(user.id);
  noteAudit({ detail: cleared });
  return NextResponse.json({ ok: true, ...cleared });
});
