/**
 * The signed-in caller's own intake form: the one for their stage of the
 * current cohort, with the answers they last saved, and saving new ones. A
 * member of the cohort test group in both stages picks one with ?form=.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMyIntake, saveMyIntake } from "@/lib/logistics/intake";
import { INTAKE_FORM_LABELS, intakeSubmissionSchema, isIntakeFormId } from "@/lib/logistics/intake-values";

const NOT_IN_COHORT = { error: "not_in_cohort" } as const;

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const want = new URL(req.url).searchParams.get("form");
  const mine = user.email ? await getMyIntake(user.email, isIntakeFormId(want) ? want : null) : null;
  if (!mine) return NextResponse.json(NOT_IN_COHORT, { status: 404 });
  return NextResponse.json(mine);
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = intakeSubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!user.email) return NextResponse.json(NOT_IN_COHORT, { status: 404 });

  const want = new URL(req.url).searchParams.get("form");
  const result = await saveMyIntake(user.email, parsed.data.answers, isIntakeFormId(want) ? want : null);
  if (!result.ok) {
    const { error: problem } = result;
    if (problem.problem === "not_in_cohort") return NextResponse.json(NOT_IN_COHORT, { status: 404 });
    if (problem.problem === "no_questions") return NextResponse.json({ error: "no_questions" }, { status: 409 });
    return NextResponse.json({ error: problem.problem, questionId: problem.questionId }, { status: 400 });
  }
  noteAudit({ target: user.email, targetLabel: `${INTAKE_FORM_LABELS[result.form]} form: ${user.email}` });
  return NextResponse.json({ form: result.form, savedAt: result.savedAt });
});
