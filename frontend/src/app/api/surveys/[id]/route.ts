/** One of the signed-in caller's own daily surveys, with their answers, and answering it. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { getMySurvey, saveMySurvey } from "@/lib/surveys/surveys";
import { surveySubmissionSchema } from "@/lib/surveys/survey-values";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "not_found" } as const;

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const { id } = await params;
  const mine = user.email ? await getMySurvey(user.email, id) : null;
  if (!mine) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json(mine);
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = surveySubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!user.email) return NextResponse.json(NOT_FOUND, { status: 404 });

  const { id } = await params;
  const result = await saveMySurvey(user.email, id, parsed.data);
  if (!result.ok) {
    const { error: problem } = result;
    if (problem.problem === "not_found") return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ error: problem.problem, sessionId: problem.sessionId }, { status: 400 });
  }
  return NextResponse.json(result.survey);
});
