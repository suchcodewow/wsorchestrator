/** Replaces the stored employees with HiBob's current list. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { importHibobEmployees, STATUS_FOR } from "@/lib/evals/hibob";

// HiBob takes several seconds to send ~1,500 employees.
export const maxDuration = 180;

export async function POST() {
  const { error, user } = await requireEvalsAdministrator();
  if (error) return error;

  const result = await importHibobEmployees(user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ count: result.count, skipped: result.skipped });
}
