/** Setting a month aside for a cohort with no guest speakers yet, and taking it off again. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { addCohort, removeCohort } from "@/lib/logistics/guest-judges";
import { cohortMonthSchema } from "@/lib/logistics/guest-judge-values";
import { canManageTrainingSettings } from "@/lib/roles";

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = cohortMonthSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ target: parsed.data.cohort, targetLabel: `Cohort ${parsed.data.cohort}` });
  const { added } = await addCohort(user.id, parsed.data.cohort);
  return NextResponse.json({ added }, { status: added ? 201 : 200 });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const cohort = new URL(req.url).searchParams.get("cohort") ?? "";
  noteAudit({ target: cohort, targetLabel: `Cohort ${cohort}` });
  if (!(await removeCohort(cohort))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
