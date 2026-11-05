/**
 * Releases the active bootcamp's BTC or INT scores to managers: from now on,
 * Reporting → Live Sessions shows that class's results below Assessments
 * Viewer, and everyone scored in it has attended it. Their managers and the
 * Additional Slack Contacts are then told in Slack, after the response
 * (`lib/reporting/release-notice.ts`); the run it answers with is logged on
 * Reporting Settings → Feedback Management as it goes.
 * Releasing a class already released changes nothing, and tells no one.
 */

import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { appBase } from "@/lib/oauth-callback";
import { RELEASE_STATUS_FOR, releaseScores } from "@/lib/reporting/bootcamp";
import { RELEASE_STAGES, STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { startReleaseNotice } from "@/lib/reporting/release-notice";
import { canManageBootcampRecords } from "@/lib/roles";

export const maxDuration = 120;

const bodySchema = z.object({ stage: z.enum(RELEASE_STAGES) });

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { stage } = parsed.data;
  const result = await releaseScores(user.id, stage);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: RELEASE_STATUS_FOR[result.error] });

  let notice: { runId: string; dryRun: boolean } | null = null;
  if (result.attendees.length > 0) {
    try {
      const run = await startReleaseNotice({
        stage,
        bootcamp: result.bootcamp,
        attendees: result.attendees,
        actorId: user.id,
        preview: false,
        reportingUrl: `${appBase(req)}/reporting/bootcamp`,
      });
      after(run.send);
      notice = { runId: run.runId, dryRun: run.dryRun };
    } catch (err) {
      // The class is released whatever happened here; say so rather than answer 500.
      console.error("release notice failed to start", err);
    }
  }

  noteAudit({
    target: result.bootcamp.id,
    targetLabel: `${STAGE_CODES[stage]} ${result.bootcamp.startDate}`,
    detail: { stage, written: result.written, notice },
  });
  return NextResponse.json({
    ok: true,
    stage,
    bootcamp: result.bootcamp,
    releasedAt: result.releasedAt,
    written: result.written,
    notice,
  });
});
