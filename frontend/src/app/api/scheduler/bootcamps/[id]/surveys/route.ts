/** A bootcamp's daily surveys: which days have been sent one, and sending a track-day's, announced in the class's Slack channel. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { appBase } from "@/lib/oauth-callback";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { bootcampExists } from "@/lib/scheduler/bootcamps";
import { announceDaySurveys } from "@/lib/surveys/survey-slack";
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

  // Only the press that first sends a day's survey announces it, so repeating one does not ping the channel again.
  const slack = result.value.some((v) => v.created && v.sent > 0)
    ? await announceDaySurveys(parsed.data.id, input.data.track, input.data.day, `${appBase(req)}/intake`)
    : null;
  if (slack) noteAudit({ detail: { slack } });
  return NextResponse.json({ surveys: result.value, slack, days: await surveyDays(parsed.data.id) });
});
