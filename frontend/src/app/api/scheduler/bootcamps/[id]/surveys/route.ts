/** A bootcamp's daily surveys: which days have been sent one, and sending a track-day's. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { bootcampExists } from "@/lib/scheduler/bootcamps";
import { ASSIGN_STATUS_FOR, assignDaySurveys, assignSurveysSchema, surveyDays } from "@/lib/surveys/surveys";

const paramsSchema = z.object({ id: z.string().uuid() });

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success || !(await bootcampExists(parsed.data.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ days: await surveyDays(parsed.data.id) });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const input = assignSurveysSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await assignDaySurveys(user.id, parsed.data.id, input.data.track, input.data.day);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ASSIGN_STATUS_FOR[result.error] });
  return NextResponse.json({ surveys: result.value, days: await surveyDays(parsed.data.id) });
});
