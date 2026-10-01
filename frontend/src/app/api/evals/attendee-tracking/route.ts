/** Adds one person to bootcamp history. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { createHistory, historyInputSchema, STATUS_FOR } from "@/lib/evals/bootcamp-history";

export async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = historyInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await createHistory(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  return NextResponse.json({ id: result.id });
}
