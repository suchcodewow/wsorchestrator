/** The logistics intake form, as Logistics settings edits it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getIntakeForm, saveIntakeForm } from "@/lib/logistics/intake";
import { intakeFormSchema } from "@/lib/logistics/intake-values";
import { canManageTrainingSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;
  return NextResponse.json(await getIntakeForm());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = intakeFormSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  noteAudit({ target: "intake-form", targetLabel: "Intake form" });
  return NextResponse.json(await saveIntakeForm(user.id, parsed.data));
});
