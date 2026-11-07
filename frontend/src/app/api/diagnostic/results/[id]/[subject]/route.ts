/** Resets one person's live sitting of one subject, so they can take it again. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { resetSitting } from "@/lib/iris/cohort";
import { isForm } from "@/lib/iris/engine";
import { SUBJECTS, isSubjectKey } from "@/lib/iris/subjects";
import { canManageIris } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string; subject: string }> };

export const DELETE = audited(async function DELETE(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const { id, subject } = await params;
  if (!isSubjectKey(subject)) return NextResponse.json({ error: "invalid_subject" }, { status: 400 });
  const form = new URL(req.url).searchParams.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const result = await resetSitting(id, subject, form);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  noteAudit({
    target: id,
    targetLabel: `${result.email ?? id}: ${SUBJECTS[subject].name}, form ${form}`,
    detail: { subject, form, deleted: result.deleted },
  });
  return NextResponse.json({ ok: true, deleted: result.deleted });
});
