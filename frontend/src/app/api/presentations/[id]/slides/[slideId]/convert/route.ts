/** Converts a slide of the deck into one of the presentation's own pages, which then stands in for it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { PRESENTATION_STATUS } from "@/lib/presentations/input";
import { saveConversion } from "@/lib/presentations/presentations";
import { canManageTrainingSettings } from "@/lib/roles";

type Params = { params: Promise<{ id: string; slideId: string }> };

// Google draws one picture per live element, at most one every 1.1s: a busy slide takes most of a minute.
export const maxDuration = 300;

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id, slideId } = await params;
  const result = await saveConversion(id, slideId, user.id);
  if (!result.ok) {
    const message = "message" in result ? result.message : undefined;
    return NextResponse.json({ error: result.error, message }, { status: PRESENTATION_STATUS[result.error] });
  }
  noteAudit({ target: result.pageId, targetLabel: `converted slide in ${result.name}` });
  return NextResponse.json(
    { pageId: result.pageId, live: result.live, animated: result.animated, animationsRead: result.animationsRead },
    { status: 201 },
  );
});
