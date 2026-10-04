/** How many checklist items each day of a bootcamp's classes has, and how many are done. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { bootcampExists } from "@/lib/scheduler/bootcamps";
import { checklistCounts } from "@/lib/scheduler/checklist";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await bootcampExists(id.data))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ days: await checklistCounts(id.data) });
}
