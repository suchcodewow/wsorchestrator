/** How many people a stage and track cover, by UTC offset, for the time zone map when picking a meeting. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { MEETING_STAGES, MEETING_TRACKS } from "@/db/schema";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { meetingTimezoneCoverage } from "@/lib/evals/google-meetings";

const querySchema = z.object({ stage: z.enum(MEETING_STAGES), track: z.enum(MEETING_TRACKS) });

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({ stage: params.get("stage"), track: params.get("track") });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  return NextResponse.json(await meetingTimezoneCoverage(parsed.data.stage, parsed.data.track));
}
