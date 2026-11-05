/**
 * Smiley and confused ratings on videos. `POST` is the buttons over a player:
 * one rating, where the video was, and the comment if one was written. `GET`
 * reads it back a page at a time, each area its own videos': Coach Canary's
 * concepts for an Assessments Administrator, the async recordings for a
 * Training Administrator.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { VIDEO_FEEDBACK_KINDS, VIDEO_FEEDBACK_LIMITS, VIDEO_FEEDBACK_RATINGS } from "@/db/schema";
import { VIDEO_FEEDBACK_LIST } from "@/lib/list-specs";
import { VIDEO_LANGUAGES, VIDEO_PREFIX } from "@/lib/mimir/map/schema";
import { parseListQuery } from "@/lib/paging";
import { canManageMimir, canManageTrainingSettings, type Access } from "@/lib/roles";
import { findVideo, listVideoFeedback, recordVideoFeedback, type VideoFeedbackFilter } from "@/lib/video-feedback";

/** Whether `access` reads feedback on this kind of video: each is its own area's. */
const readsKind = (access: Access, kind: (typeof VIDEO_FEEDBACK_KINDS)[number]) =>
  kind === "recording" ? canManageTrainingSettings(access) : canManageMimir(access);

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, (a) => VIDEO_FEEDBACK_KINDS.some((k) => readsKind(a, k)));
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const asked = VIDEO_FEEDBACK_KINDS.find((k) => k === params.get("kind"));
  if (asked && !readsKind(user.access, asked)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const readable = VIDEO_FEEDBACK_KINDS.filter((k) => readsKind(user.access, k));
  const filter: VideoFeedbackFilter = {
    // Without a kind, everything the caller may read: one kind, or both for someone who administers both areas.
    kind: asked ?? (readable.length === 1 ? readable[0] : undefined),
    rating: VIDEO_FEEDBACK_RATINGS.find((r) => r === params.get("rating")),
    video: params.get("video") || undefined,
  };
  const { rows, page, hasMore } = await listVideoFeedback(parseListQuery(params, VIDEO_FEEDBACK_LIST), filter);
  return NextResponse.json({ feedback: rows, page, hasMore });
}

const feedbackSchema = z.object({
  video: z.object({
    kind: z.enum(VIDEO_FEEDBACK_KINDS),
    id: z.string().min(1).max(200),
    language: z.enum(VIDEO_LANGUAGES).optional(),
    object: z.string().startsWith(VIDEO_PREFIX).max(200).optional(),
  }),
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
    detail: { rating: feedback.rating, position: feedback.positionSeconds, commented: comment !== null, language: feedback.language, object: feedback.videoObject },
  });
  return NextResponse.json({ feedback }, { status: 201 });
});
