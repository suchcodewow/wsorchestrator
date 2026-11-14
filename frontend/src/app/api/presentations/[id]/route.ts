/** One presentation with every slide and its speaker notes; renaming it, and removing it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { renamePresentationSchema } from "@/lib/presentations/input";
import { deletePresentation, getPresentation, renamePresentation } from "@/lib/presentations/presentations";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const presentation = await getPresentation((await params).id);
  if (!presentation) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(presentation);
}

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = renamePresentationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const { id } = await params;
  const name = await renamePresentation(id, parsed.data.name);
  if (name === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: id, targetLabel: name });
  return NextResponse.json({ ok: true, name });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id } = await params;
  const name = await deletePresentation(id);
  if (name === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: id, targetLabel: name });
  return NextResponse.json({ ok: true });
});
