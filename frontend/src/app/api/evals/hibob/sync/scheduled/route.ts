/**
 * The daily HiBob sync, called by Cloud Scheduler at 3 AM Eastern
 * (infra/admin/scheduler.tf).
 *
 * The app is public, so Cloud Run's IAM does not stand between this route and
 * the internet. The scheduler sends a Google-signed OIDC token instead, and
 * only one carrying `HIBOB_SYNC_AUDIENCE` for the `HIBOB_SYNC_INVOKER` service
 * account is accepted. Either unset refuses every call.
 *
 * A successful sync is followed by the cohort Slack channel sync
 * (`lib/cohorts/slack-sync.ts`), which skips itself when no bootcamp is active.
 * Its own failure is logged on Cohort Settings' Slack tab and does not fail
 * this call: the HiBob sync it follows went through.
 */

import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { STATUS_FOR, syncHibobEmployees } from "@/lib/evals/hibob";
import { audited, noteAudit } from "@/lib/audit";
import { syncSlackChannels } from "@/lib/cohorts/slack-sync";

// Cloud Scheduler's attempt_deadline (infra/admin/scheduler.tf) is the same.
export const maxDuration = 300;

/** When the Slack sync must stop by, leaving time to log the run and answer. */
const SLACK_DEADLINE_MS = 270_000;

const google = new OAuth2Client();

async function fromScheduler(req: Request): Promise<boolean> {
  const audience = process.env.HIBOB_SYNC_AUDIENCE;
  const invoker = process.env.HIBOB_SYNC_INVOKER;
  if (!audience || !invoker) return false;

  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return false;

  try {
    const payload = (await google.verifyIdToken({ idToken: token, audience })).getPayload();
    return payload?.email === invoker && payload.email_verified === true;
  } catch {
    return false;
  }
}

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  if (!(await fromScheduler(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // A failure is logged on the HiBob tab either way; the status tells Cloud
  // Scheduler too, so its own history agrees.
  const result = await syncHibobEmployees("schedule", null);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }

  const slack = await syncSlackChannels("schedule", null, started + SLACK_DEADLINE_MS).catch((err: unknown) => ({
    ok: false as const,
    runId: null,
    error: "failed",
    detail: err instanceof Error ? err.message : String(err),
  }));
  noteAudit({ detail: { slack } });
  return NextResponse.json({ count: result.count, skipped: result.skipped, slack });
});
