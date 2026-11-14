/** Adds one of a presentation's own pages, blank, before a slide of its deck. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { createPageSchema, PRESENTATION_STATUS } from "@/lib/presentations/input";
import { createPage } from "@/lib/presentations/presentations";
import { canManageTrainingSettings } from "@/lib/roles";

type Params = { params: Promise<{ id: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = createPageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const { id } = await params;
  const result = await createPage(id, parsed.data.before, user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: PRESENTATION_STATUS[result.error] });
  noteAudit({ target: result.id, targetLabel: `page in ${result.name}` });
  return NextResponse.json({ id: result.id }, { status: 201 });
});
