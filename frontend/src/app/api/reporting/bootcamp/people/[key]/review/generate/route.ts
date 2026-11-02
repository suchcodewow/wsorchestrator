/** Claude's one-sentence overall feedback for one side of someone's class review, for the form; nothing is saved. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { OVERALL_SIDES, RELEASE_STAGES, STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { SUGGEST_STATUS_FOR, suggestOverallFeedback } from "@/lib/reporting/overall-feedback";
import { canManageBootcampRecords } from "@/lib/roles";

export const maxDuration = 300;

const bodySchema = z.object({
  bootcampId: z.string().uuid(),
  stage: z.enum(RELEASE_STAGES),
  side: z.enum(OVERALL_SIDES),
});

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { error } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { bootcampId, stage, side } = parsed.data;
  const result = await suggestOverallFeedback((await params).key, bootcampId, stage, side);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SUGGEST_STATUS_FOR[result.error] });
  noteAudit({
    target: `${bootcampId}:${stage}:${result.email}`,
    targetLabel: `${STAGE_CODES[stage]} review: ${result.email}`,
    detail: { bootcampId, side },
  });
  return NextResponse.json({ text: result.text });
});
