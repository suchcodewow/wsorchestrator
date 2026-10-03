/** One bootcamp's guest judges, a page at a time, and adding one. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { JUDGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { getBootcamp } from "@/lib/scheduler/bootcamps";
import { addJudge, addJudgeSchema, JUDGE_STATUS_FOR, judgeCount, listJudges } from "@/lib/scheduler/judges";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await getBootcamp(id.data))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const query = parseListQuery(new URL(req.url).searchParams, JUDGE_LIST);
  const [{ rows, page, hasMore }, total] = await Promise.all([listJudges(id.data, query), judgeCount(id.data)]);
  return NextResponse.json({ judges: rows, page, hasMore, total });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = addJudgeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await addJudge(user.id, id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: JUDGE_STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.judge.id, targetLabel: `${result.judge.email}, judging bootcamp ${id.data}` });
  return NextResponse.json(result.judge);
});
