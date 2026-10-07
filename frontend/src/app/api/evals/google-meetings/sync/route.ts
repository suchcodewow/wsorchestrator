/** Sync Now: creates and updates the Google Calendar invite and Zoom meeting of every meeting still to end. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { syncGoogleMeetings, type GoogleSyncFailure } from "@/lib/evals/google-meetings-sync";

// Each meeting is a few calls to Google and Zoom, one meeting after another.
export const maxDuration = 300;

const STATUS_FOR: Record<GoogleSyncFailure, number> = {
  not_connected: 409,
  not_configured: 503,
  running: 409,
  revoked: 409,
  failed: 502,
};

export const POST = audited(async function POST(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const result = await syncGoogleMeetings();
  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.message }, { status: STATUS_FOR[result.error] });
  }
  const failed = result.meetings.filter((m) => m.outcome === "failed").length;
  noteAudit({
    targetLabel: result.account,
    detail: {
      created: result.meetings.filter((m) => m.outcome === "created").length,
      updated: result.meetings.filter((m) => m.outcome === "updated").length,
      failed,
    },
  });
  return NextResponse.json(result);
});
