/**
 * Each Mimir video that has feedback, with how many smiley and confused ratings it has
 * and how many of them came with a comment, for Mimir Settings → Mimir
 * Feedback. A video's own feedback is `GET /api/video-feedback`.
 */

import { NextResponse } from "next/server";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listVideoFeedbackSummary } from "@/lib/video-feedback";

export async function GET(req: Request) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, VIDEO_FEEDBACK_SUMMARY_LIST);
  const { rows, page, hasMore } = await listVideoFeedbackSummary(query);
  return NextResponse.json({ videos: rows, page, hasMore });
}
