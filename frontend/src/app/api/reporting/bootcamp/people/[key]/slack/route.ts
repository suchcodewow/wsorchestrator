/**
 * The Slack button on a Live Sessions card: finds, unarchives or makes the
 * attendee's private channel, brings its members in line, and posts a link
 * back to the card there. 404 for someone the caller may not see.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { appBase } from "@/lib/oauth-callback";
import { readerOf } from "@/lib/reporting/bootcamp";
import { openFeedbackChannel, STATUS_FOR } from "@/lib/reporting/feedback-channels";
import { canSeeBootcampRecords } from "@/lib/roles";

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const { key } = await params;
  const cardUrl = `${appBase(req)}/reporting/bootcamp/${encodeURIComponent(key)}`;
  const outcome = await openFeedbackChannel(user, readerOf(user), key, cardUrl);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.detail ? { detail: outcome.detail } : {}) },
      { status: STATUS_FOR[outcome.error] },
    );
  }
  const { result, attendee } = outcome;
  noteAudit({
    target: attendee.email,
    targetLabel: `#${result.name}`,
    detail: {
      channelId: result.channelId,
      created: result.created,
      unarchived: result.unarchived,
      invited: result.invited,
      removed: result.removed,
      skipped: result.skipped,
    },
  });
  return NextResponse.json(result);
});
