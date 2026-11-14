/** Reads a presentation's deck from Google Slides again. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { PRESENTATION_STATUS } from "@/lib/presentations/input";
import { syncPresentation } from "@/lib/presentations/presentations";
import { canManageTrainingSettings } from "@/lib/roles";

type Params = { params: Promise<{ id: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id } = await params;
  const result = await syncPresentation(id);
  if (!result.ok) {
    const message = "message" in result ? result.message : undefined;
    return NextResponse.json({ error: result.error, message }, { status: PRESENTATION_STATUS[result.error] });
  }
  noteAudit({ target: id, targetLabel: result.name });
  return NextResponse.json({ ok: true, slides: result.slides, changed: result.changed });
});
