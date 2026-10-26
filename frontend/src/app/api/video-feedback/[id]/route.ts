/**
 * One piece of video feedback, as an Assessments Administrator moderates it
 * from Mimir Settings → Mimir Feedback: the words of its comment, and whether
 * the comment is accepted or ignored.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { VIDEO_FEEDBACK_LIMITS } from "@/db/schema";
import { updateVideoFeedback } from "@/lib/video-feedback";

type Params = { params: Promise<{ id: string }> };

const editSchema = z
  .object({
    comment: z.string().trim().min(1).max(VIDEO_FEEDBACK_LIMITS.comment).optional(),
    // "applied" is set only by a regeneration that took the comment in.
    status: z.enum(["pending", "accepted", "ignored"]).optional(),
  })
  .refine((v) => v.comment !== undefined || v.status !== undefined);

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = (await params).id;
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateVideoFeedback(id, parsed.data);
  if (result === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result === "no_comment") return NextResponse.json({ error: "no_comment" }, { status: 409 });

  const { before, after } = result;
  noteAudit({
    target: id,
    targetLabel: after.video.label,
    detail: {
      ...(before.comment !== after.comment ? { commentBefore: before.comment, commentAfter: after.comment } : {}),
      ...(before.status !== after.status ? { statusBefore: before.status, statusAfter: after.status } : {}),
    },
  });
  return NextResponse.json({ feedback: after });
});
