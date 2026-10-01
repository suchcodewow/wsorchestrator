/** The employees stored from the last HiBob sync. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { listEmployees } from "@/lib/evals/roster";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  return NextResponse.json(await listEmployees());
}
