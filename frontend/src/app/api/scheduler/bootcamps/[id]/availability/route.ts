/** Who and which rooms are busy during a stretch of one day of a bootcamp, across all four tracks, and with what. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { BOOTCAMP_LIMITS, SCHEDULE_LIMITS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { availability, scheduleBootcamp } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

const slotSchema = z.object({
  day: z.coerce.number().int().min(1).max(BOOTCAMP_LIMITS.maxDays),
  /** Minutes after midnight. */
  start: z.coerce.number().int().min(0).max(24 * 60),
  minutes: z.coerce.number().int().min(SCHEDULE_LIMITS.slot).max(SCHEDULE_LIMITS.maxMinutes),
  /** A session to leave out: the one being edited. */
  exclude: z.string().uuid().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const bootcamp = id.success ? await scheduleBootcamp(id.data) : null;
  if (!bootcamp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const query = new URL(req.url).searchParams;
  const slot = slotSchema.safeParse(Object.fromEntries(query));
  if (!slot.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { day, start, minutes, exclude } = slot.data;
  return NextResponse.json({ day, start, end: start + minutes, ...(await availability(bootcamp, { day, start, minutes, excludeId: exclude })) });
}
