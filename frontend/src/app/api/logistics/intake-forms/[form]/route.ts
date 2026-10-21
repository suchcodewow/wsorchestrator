/** One logistics intake form, Pre-Bootcamp (`bootcamp`) or Pre-Intermediate (`intermediate`), as Logistics settings edits it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getEditableIntakeForm, saveIntakeForm } from "@/lib/logistics/intake";
import { INTAKE_FORM_LABELS, intakeFormSchema, isIntakeFormId } from "@/lib/logistics/intake-values";
import { canManageTrainingSettings } from "@/lib/roles";

type Ctx = { params: Promise<{ form: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { form } = await params;
  if (!isIntakeFormId(form)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(await getEditableIntakeForm(form));
}

export const PUT = audited(async function PUT(req: Request, { params }: Ctx) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { form } = await params;
  if (!isIntakeFormId(form)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = intakeFormSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  noteAudit({ target: `intake-form:${form}`, targetLabel: `${INTAKE_FORM_LABELS[form]} form` });
  return NextResponse.json(await saveIntakeForm(user.id, form, parsed.data));
});
