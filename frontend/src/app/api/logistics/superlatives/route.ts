/** The standing list of superlatives every Bootcamp's superlatives survey asks, as Logistics settings edits it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { superlativeListSchema } from "@/lib/surveys/superlative-values";
import { getSuperlativeList, saveSuperlativeList } from "@/lib/surveys/superlatives";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  return NextResponse.json(await getSuperlativeList());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = superlativeListSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  return NextResponse.json(await saveSuperlativeList(user.id, parsed.data));
});
