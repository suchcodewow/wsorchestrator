/** Syncs the stored employees with HiBob now — the HiBob tab's button. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { STATUS_FOR, syncHibobEmployees } from "@/lib/evals/hibob";

// HiBob takes several seconds to send ~1,500 employees.
export const maxDuration = 180;

export async function POST() {
  const { error, user } = await requireEvalsAdministrator();
  if (error) return error;

  const result = await syncHibobEmployees("manual", user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ count: result.count, skipped: result.skipped });
}
