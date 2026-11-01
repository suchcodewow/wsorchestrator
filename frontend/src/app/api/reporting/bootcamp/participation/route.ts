/**
 * What each class's Generate button would write, and pressing it: fills the
 * blank scores and comments in one class's Participation assessments.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { GENERATE_STATUS_FOR, generateParticipation, pendingParticipation } from "@/lib/evals/participation";
import { RELEASE_STAGES, STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { canManageBootcampRecords } from "@/lib/roles";

export const maxDuration = 300;

const bodySchema = z.object({ stage: z.enum(RELEASE_STAGES) });

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;
  return NextResponse.json(await pendingParticipation());
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { stage } = parsed.data;
  const result = await generateParticipation(user.id, stage);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: GENERATE_STATUS_FOR[result.error] });

  const { bootcamp, ...counts } = result;
  noteAudit({
    target: bootcamp.id,
    targetLabel: `Participation ${STAGE_CODES[stage]} ${bootcamp.startDate}`,
    detail: { stage, people: counts.people, scores: counts.scores, comments: counts.comments, failed: counts.failed },
  });
  return NextResponse.json({ ...counts, stage, bootcamp });
});
