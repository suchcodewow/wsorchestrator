/** Generate AI Summary on a daily survey's results: Claude's summary of each session it asked about, kept on the survey. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { SUMMARY_STATUS_FOR, summarizeSurvey } from "@/lib/surveys/survey-summary";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const result = await summarizeSurvey((await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SUMMARY_STATUS_FOR[result.error] });
  return NextResponse.json({ summaries: result.summaries, summarizedAt: result.summarizedAt });
});
