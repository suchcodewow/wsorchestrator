/** The jobs Cloud Scheduler runs, with whether each is on and how its last run went. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { canManageTimedJobs } from "@/lib/roles";
import { listTimedJobs } from "@/lib/timed-jobs";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTimedJobs);
  if (error) return error;
  return NextResponse.json({ jobs: await listTimedJobs() });
}
