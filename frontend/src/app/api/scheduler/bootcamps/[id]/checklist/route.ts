/** How many checklist items each day of a bootcamp's classes has, how many are done, and those the schedule marks at their time. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { canSeeScheduler } from "@/lib/roles";
import { mayReadBootcamp } from "@/lib/scheduler/judging";
import { bootcampExists } from "@/lib/scheduler/bootcamps";
import { checklistCounts, checklistMarks } from "@/lib/scheduler/checklist";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canSeeScheduler);
  if (error) return error;
  if (!(await mayReadBootcamp(user.access, (await params).id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await bootcampExists(id.data))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [days, marks] = await Promise.all([checklistCounts(id.data), checklistMarks(id.data)]);
  return NextResponse.json({ days, marks });
}
