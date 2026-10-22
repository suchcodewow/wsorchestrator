/**
 * The daily Google Meetings sync, called by Cloud Scheduler at 4 AM Eastern
 * (infra/admin/scheduler.tf). The same run as Sync Now on eVals Settings →
 * Google Meetings, logged there as the schedule's, and a dry run until an
 * administrator turns the sync live.
 *
 * Only a Google-signed OIDC token with `MEETING_SYNC_AUDIENCE` from
 * `MEETING_SYNC_INVOKER` is accepted; either unset refuses every call.
 */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { runMeetingSync, SYNC_STATUS_FOR } from "@/lib/evals/meeting-sync";
import { fromInvoker } from "@/lib/oidc-caller";
import { runTimedJob } from "@/lib/timed-jobs";

// Cloud Scheduler's attempt_deadline (infra/admin/scheduler.tf) is the same.
export const maxDuration = 300;

/** When the run must stop by, leaving time to log it and answer. */
const DEADLINE_MS = 270_000;

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  if (!(await fromInvoker(req, process.env.MEETING_SYNC_AUDIENCE, process.env.MEETING_SYNC_INVOKER))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return runTimedJob(
    "google-meetings-sync",
    async () => {
      const result = await runMeetingSync("schedule", null, started + DEADLINE_MS);
      if (result.runId) noteAudit({ target: result.runId, targetLabel: "Google Meetings sync" });
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, detail: result.detail, runId: result.runId },
          { status: SYNC_STATUS_FOR[result.error] },
        );
      }
      noteAudit({ detail: { ...result } });
      return NextResponse.json(result);
    },
    (body) => {
      if (typeof body.invited !== "number" || typeof body.removed !== "number") return null;
      const summary = `${body.invited} invited, ${body.removed} removed`;
      return body.dryRun === true ? `Dry run: ${summary}` : summary;
    },
  );
});
