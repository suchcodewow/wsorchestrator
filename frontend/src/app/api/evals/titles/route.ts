/** The Sales, Engineer and Ignored title lists, and adding to them. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { addTitles, addTitlesSchema, listTitles } from "@/lib/evals/titles";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json({ titles: await listTitles() });
}

export async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = addTitlesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addTitles(user.id, parsed.data.list, parsed.data.titles);
  return NextResponse.json(result);
}
