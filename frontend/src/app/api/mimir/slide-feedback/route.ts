/**
 * Ratings on slide review slides: anyone signed in rates the slide in front
 * of them, by its seed; Coach Canary's administrators read them back, a page
 * at a time, for Coach Canary Settings → Coach Canary Feedback.
 */

import { NextResponse } from "next/server";
import { requireMimirAdministrator, requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { SLIDE_FEEDBACK_LIST } from "@/lib/list-specs";
import { listSlideFeedback, recordSlideFeedback, slideFeedbackSchema } from "@/lib/mimir/slide-feedback";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  const { rows, page, hasMore } = await listSlideFeedback(parseListQuery(new URL(req.url).searchParams, SLIDE_FEEDBACK_LIST));
  return NextResponse.json({ feedback: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = slideFeedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const feedback = await recordSlideFeedback(user.id, parsed.data);
  noteAudit({ target: feedback.id, targetLabel: `Slide ${feedback.seed}`, detail: { seed: feedback.seed, rating: feedback.rating } });
  return NextResponse.json({ feedback }, { status: 201 });
});
