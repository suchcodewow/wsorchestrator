/** The public intake form's endpoints: reading the form, and sending answers to it. */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { getIntakeForm, submitIntake } from "@/lib/logistics/intake";
import { intakeSubmissionSchema } from "@/lib/logistics/intake-values";

export async function GET() {
  const { title, description, questions } = await getIntakeForm();
  return NextResponse.json({ title, description, questions });
}

export const POST = audited(async function POST(req: Request) {
  const parsed = intakeSubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { email, answers } = parsed.data;
  noteAudit({ target: email, targetLabel: email });
  const result = await submitIntake(email, answers);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.problem, questionId: result.error.questionId }, { status: 400 });
  }
  return NextResponse.json({ id: result.id }, { status: 201 });
});
