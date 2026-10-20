/** The names of the meetings on the Revenue Enablement calendar in the next 60 days, each once, for picking one. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { SYNC_STATUS_FOR, upcomingMeetingNames } from "@/lib/evals/meeting-sync";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const result = await upcomingMeetingNames();
  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.message }, { status: SYNC_STATUS_FOR[result.error] });
  }
  return NextResponse.json({ names: result.names });
}
