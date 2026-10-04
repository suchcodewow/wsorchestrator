/** One bootcamp's whole schedule: every track-day's sessions in order, its rooms, and who can run a session. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { loadSchedule } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const schedule = id.success ? await loadSchedule(id.data) : null;
  if (!schedule) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(schedule);
}
