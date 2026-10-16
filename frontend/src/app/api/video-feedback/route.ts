/**
 * Thumbs up and thumbs down on videos. `POST` is the buttons over a player:
 * one thumb, where the video was, and the comment if one was written. `GET`
 * reads it all back a page at a time, for Training Administrators.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { VIDEO_FEEDBACK_KINDS, VIDEO_FEEDBACK_LIMITS, VIDEO_FEEDBACK_RATINGS } from "@/db/schema";
import { VIDEO_FEEDBACK_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";
import { findVideo, listVideoFeedback, recordVideoFeedback, type VideoFeedbackFilter } from "@/lib/video-feedback";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const filter: VideoFeedbackFilter = {
    kind: VIDEO_FEEDBACK_KINDS.find((k) => k === params.get("kind")),
    rating: VIDEO_FEEDBACK_RATINGS.find((r) => r === params.get("rating")),
  };
  const { rows, page, hasMore } = await listVideoFeedback(parseListQuery(params, VIDEO_FEEDBACK_LIST), filter);
  return NextResponse.json({ feedback: rows, page, hasMore });
}

const feedbackSchema = z.object({
  video: z.object({ kind: z.enum(VIDEO_FEEDBACK_KINDS), id: z.string().min(1).max(200) }),
  rating: z.enum(VIDEO_FEEDBACK_RATINGS),
  position: z.number().finite().min(0).max(VIDEO_FEEDBACK_LIMITS.position),
  comment: z.string().max(VIDEO_FEEDBACK_LIMITS.comment).optional(),
});

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req);
  if (error) return error;

  const parsed = feedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const video = await findVideo(user.access, parsed.data.video);
  if (video === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!video) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const comment = parsed.data.comment?.trim() || null;
  const feedback = await recordVideoFeedback(user.id, video, { rating: parsed.data.rating, position: parsed.data.position, comment });
  noteAudit({
    target: feedback.id,
    targetLabel: video.label,
    detail: { rating: feedback.rating, position: feedback.positionSeconds, commented: comment !== null },
  });
  return NextResponse.json({ feedback }, { status: 201 });
});
