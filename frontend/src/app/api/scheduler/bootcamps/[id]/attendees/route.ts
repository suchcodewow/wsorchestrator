/** The attendees a session on one of a bootcamp's tracks is taught to, for one audience. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { SCHEDULE_TRACKS, SESSION_AUDIENCES } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { classAttendees } from "@/lib/scheduler/attendees";
import { scheduleBootcamp } from "@/lib/scheduler/schedule";
import { stageOf } from "@/lib/scheduler/timeline";

const idSchema = z.string().uuid();

const querySchema = z.object({
  track: z.enum(SCHEDULE_TRACKS),
  audience: z.enum(SESSION_AUDIENCES).default("both"),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const bootcamp = id.success ? await scheduleBootcamp(id.data) : null;
  if (!bootcamp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const query = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { track, audience } = query.data;
  return NextResponse.json({ track, audience, stage: stageOf(track), ...(await classAttendees(track, audience)) });
}
