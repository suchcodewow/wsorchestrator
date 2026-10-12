/** The Welcome page's "Running a Live Training Session" steps, as far as your roles let you see them. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { liveTraining } from "@/lib/live-training";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json(await liveTraining(user.access));
}
