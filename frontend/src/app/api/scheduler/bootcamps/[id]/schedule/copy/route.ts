/** The bootcamps whose schedule this one can start from, and copying one in. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { FILL_STATUS_FOR, copySchedule, copySources, scheduleBootcamp } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

const copySchema = z.object({
  /** The bootcamp to copy from. */
  from: z.string().uuid(),
  /** Whether to replace the sessions it has; without it, a bootcamp with any is refused. */
  replace: z.boolean().default(false),
});

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await scheduleBootcamp(id.data))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ sources: await copySources(id.data) });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = copySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await copySchedule(user.id, id.data, parsed.data.from, parsed.data.replace);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: FILL_STATUS_FOR[result.error] });
  return NextResponse.json(result.summary);
});
