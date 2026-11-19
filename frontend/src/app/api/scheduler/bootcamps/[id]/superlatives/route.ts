/** A Bootcamp's superlatives survey: whether it is out, and sending it to the class, announced in the class's Slack channel. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { appBase } from "@/lib/oauth-callback";
import { canManageTrainingSettings, canSeeScheduler } from "@/lib/roles";
import { mayReadBootcamp } from "@/lib/scheduler/judging";
import { bootcampExists } from "@/lib/scheduler/bootcamps";
import { announceSuperlatives } from "@/lib/surveys/survey-slack";
import { SEND_STATUS_FOR, sendSuperlatives, superlativeStatus, unassignSuperlatives } from "@/lib/surveys/superlatives";

const paramsSchema = z.object({ id: z.string().uuid() });

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canSeeScheduler);
  if (error) return error;
  if (!(await mayReadBootcamp(user.access, (await params).id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success || !(await bootcampExists(parsed.data.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ status: await superlativeStatus(parsed.data.id) });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await sendSuperlatives(user.id, parsed.data.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SEND_STATUS_FOR[result.error] });

  // Only the press that first sends it announces it, so sending to latecomers does not ping the channel again.
  const slack =
    result.value.created && result.value.sent > 0 ? await announceSuperlatives(parsed.data.id, `${appBase(req)}/intake`) : null;
  if (slack) noteAudit({ detail: { slack } });
  return NextResponse.json({ survey: result.value, slack, status: await superlativeStatus(parsed.data.id) });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await unassignSuperlatives(parsed.data.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ...result.value, status: await superlativeStatus(parsed.data.id) });
});
