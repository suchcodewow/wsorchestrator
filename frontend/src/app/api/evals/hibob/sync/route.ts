/** The HiBob sync history, and syncing now — the HiBob tab's button. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import {
  hibobServiceUser,
  listHibobSyncRuns,
  STATUS_FOR,
  syncHibobEmployees,
} from "@/lib/evals/hibob";

// HiBob takes several seconds to send ~1,500 employees.
export const maxDuration = 180;

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  return NextResponse.json({
    runs: await listHibobSyncRuns(),
    serviceUser: hibobServiceUser(),
  });
}

export async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
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
