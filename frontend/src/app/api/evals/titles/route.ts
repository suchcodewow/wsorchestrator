/** Adds titles to one of the Sales, Engineer or Ignored lists. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { addTitles, addTitlesSchema } from "@/lib/evals/titles";

export async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator();
  if (error) return error;

  const parsed = addTitlesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addTitles(user.id, parsed.data.list, parsed.data.titles);
  return NextResponse.json(result);
}
