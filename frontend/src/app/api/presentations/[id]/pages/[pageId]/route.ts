/** One of a presentation's own pages: reading it, saving it whole, and removing it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { PRESENTATION_STATUS, savePageSchema } from "@/lib/presentations/input";
import { deletePage, getPage, savePage } from "@/lib/presentations/presentations";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";

type Params = { params: Promise<{ id: string; pageId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { id, pageId } = await params;
  const found = await getPage(id, pageId);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(found.page);
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = savePageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const { id, pageId } = await params;
  const saved = await savePage(id, pageId, parsed.data, user.id);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: PRESENTATION_STATUS[saved.error] });
  noteAudit({ target: pageId, targetLabel: `page in ${saved.name}` });
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id, pageId } = await params;
  const name = await deletePage(id, pageId);
  if (name === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: pageId, targetLabel: `page in ${name}` });
  return NextResponse.json({ ok: true });
});
