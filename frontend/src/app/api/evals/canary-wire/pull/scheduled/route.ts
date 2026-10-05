/**
 * The Canary Wire's pull every two hours, called by Cloud Scheduler every five
 * minutes for the first half hour of each even hour (infra/admin/scheduler.tf).
 * Each call works on a pull already running — including one a closed tab left
 * halfway — or starts one if none started in the last 90 minutes.
 *
 * Only a Google-signed OIDC token with `CANARY_WIRE_PULL_AUDIENCE` from
 * `CANARY_WIRE_PULL_INVOKER` is accepted; either unset refuses every call.
 */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { scheduledStep } from "@/lib/canary-wire/pull";
import { fromInvoker } from "@/lib/oidc-caller";

// Cloud Scheduler's attempt_deadline (infra/admin/scheduler.tf) is the same.
export const maxDuration = 300;

export const POST = audited(async function POST(req: Request) {
  if (!(await fromInvoker(req, process.env.CANARY_WIRE_PULL_AUDIENCE, process.env.CANARY_WIRE_PULL_INVOKER))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { outcome, pull } = await scheduledStep();
  if (outcome === "not_configured") return NextResponse.json({ error: "not_configured" }, { status: 409 });
  if (pull) noteAudit({ target: pull.id, targetLabel: "Canary Wire pull from Mindtickle", detail: { outcome, status: pull.status } });
  return NextResponse.json({ outcome, pull });
});
