/** One bootcamp's whole schedule: every track-day's sessions in order, its rooms, and who can run a session. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { canSeeScheduler } from "@/lib/roles";
import { mayReadBootcamp } from "@/lib/scheduler/judging";
import { loadSchedule } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canSeeScheduler);
  if (error) return error;
  if (!(await mayReadBootcamp(user.access, (await params).id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = idSchema.safeParse((await params).id);
  const schedule = id.success ? await loadSchedule(id.data) : null;
  if (!schedule) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(schedule);
}
