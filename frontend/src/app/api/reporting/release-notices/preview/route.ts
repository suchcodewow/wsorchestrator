/**
 * Previews the message releasing the active bootcamp's BTC or INT scores
 * would send: logs a run of who would get it, without releasing anything or
 * sending a message, whether Slack is live or not.
 */

import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { appBase } from "@/lib/oauth-callback";
import { classAttendees, cohortBootcamp } from "@/lib/reporting/bootcamp";
import { RELEASE_STAGES, STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { startReleaseNotice } from "@/lib/reporting/release-notice";
import { canManageBootcampRecords } from "@/lib/roles";

const bodySchema = z.object({ stage: z.enum(RELEASE_STAGES) }).strict();

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { stage } = parsed.data;

  const bootcamp = await cohortBootcamp();
  if (!bootcamp) return NextResponse.json({ error: "no_bootcamp" }, { status: 409 });
  if (stage === "intermediate" && !bootcamp.intermediate) return NextResponse.json({ error: "no_intermediate" }, { status: 409 });

  const run = await startReleaseNotice({
    stage,
    bootcamp: { id: bootcamp.id, startDate: bootcamp.startDate },
    attendees: await classAttendees(bootcamp.id, stage),
    actorId: user.id,
    preview: true,
    reportingUrl: `${appBase(req)}/reporting/bootcamp`,
  });
  after(run.send);
  noteAudit({ target: run.runId, targetLabel: `Preview of the ${STAGE_CODES[stage]} ${bootcamp.startDate} release message` });
  return NextResponse.json({ runId: run.runId }, { status: 201 });
});
