/** The Welcome page's Upcoming Sessions: the bootcamps not yet over, soonest first. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { upcomingBootcamps } from "@/lib/scheduler/bootcamps";

export async function GET(req: Request) {
  const { error } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({ sessions: await upcomingBootcamps() });
}
