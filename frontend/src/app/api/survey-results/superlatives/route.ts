/** The Bootcamp superlatives surveys anyone has voted on, the latest Bootcamp first. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { canUseTraining } from "@/lib/roles";
import { listSuperlativeResults } from "@/lib/surveys/superlatives";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  return NextResponse.json({ surveys: await listSuperlativeResults() });
}
