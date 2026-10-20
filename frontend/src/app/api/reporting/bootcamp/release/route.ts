/**
 * Releases the active bootcamp's BTC or INT scores to managers: from now on,
 * Reporting → Bootcamp shows that class's results below Assessments Viewer,
 * and everyone scored in it has the class written to bootcamp history.
 * Releasing a class already released changes nothing.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { RELEASE_STATUS_FOR, releaseScores } from "@/lib/reporting/bootcamp";
import { RELEASE_STAGES, STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { canManageBootcampRecords } from "@/lib/roles";

const bodySchema = z.object({ stage: z.enum(RELEASE_STAGES) });

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { stage } = parsed.data;
  const result = await releaseScores(user.id, stage);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: RELEASE_STATUS_FOR[result.error] });

  noteAudit({
    target: result.bootcamp.id,
    targetLabel: `${STAGE_CODES[stage]} ${result.bootcamp.startDate}`,
    detail: { stage, written: result.written },
  });
  return NextResponse.json({
    ok: true,
    stage,
    bootcamp: result.bootcamp,
    releasedAt: result.releasedAt,
    written: result.written,
  });
});
