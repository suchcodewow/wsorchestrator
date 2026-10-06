/** One person's Iris sittings with every answer they gave, and clearing them so they can start over. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { clearResults, personDetail } from "@/lib/iris/cohort";
import { isForm } from "@/lib/iris/engine";
import { canManageIris } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const form = new URL(req.url).searchParams.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  const detail = await personDetail((await params).id, form);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}

export const DELETE = audited(async function DELETE(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const result = await clearResults((await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  noteAudit({ targetLabel: result.email ?? undefined, detail: { deleted: result.deleted } });
  return NextResponse.json({ ok: true, deleted: result.deleted });
});
