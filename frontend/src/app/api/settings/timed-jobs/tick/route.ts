/**
 * The Timed Jobs dispatcher's tick, called by Cloud Scheduler every five
 * minutes (`timed-jobs-tick` in infra/admin/scheduler.tf). Starts each of the
 * app's own jobs whose schedule on Admin Settings → Timed Jobs has fallen due
 * (`dispatchTimedJobs` in `lib/timed-jobs.ts`), side by side, and answers how
 * each went: 502 if any failed, so Cloud Scheduler's history shows it too.
 *
 * Only a Google-signed OIDC token with `TIMED_JOBS_AUDIENCE` from
 * `TIMED_JOBS_INVOKER` is accepted; either unset refuses every call.
 */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { appBase } from "@/lib/oauth-callback";
import { fromInvoker } from "@/lib/oidc-caller";
import { dispatchTimedJobs } from "@/lib/timed-jobs";
import { timedJobDef } from "@/lib/timed-jobs-registry";

// Cloud Scheduler's attempt_deadline (infra/admin/scheduler.tf) is the same.
export const maxDuration = 300;

/** When a job must stop by, leaving time to record it and answer. */
const DEADLINE_MS = 270_000;

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  if (!(await fromInvoker(req, process.env.TIMED_JOBS_AUDIENCE, process.env.TIMED_JOBS_INVOKER))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ran = await dispatchTimedJobs(new Date(started), { appUrl: appBase(req), deadline: started + DEADLINE_MS });
  if (ran.length === 1) noteAudit({ target: ran[0]!.key, targetLabel: timedJobDef(ran[0]!.key)?.name ?? ran[0]!.key });
  noteAudit({ detail: { ran } });
  const failed = ran.some((run) => run.status < 200 || run.status >= 300);
  return NextResponse.json({ ran }, { status: failed ? 502 : 200 });
});
