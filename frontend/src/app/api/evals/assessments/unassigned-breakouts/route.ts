/** The breakouts at upcoming and running bootcamps that name no assessment. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { unassignedBreakouts } from "@/lib/scheduler/schedule";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const { rows, total } = await unassignedBreakouts();
  return NextResponse.json({ breakouts: rows, total });
}
