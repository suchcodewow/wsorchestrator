/**
 * Whether the Slack button on a Live Sessions card invites the attendee's
 * reporting line (`live`), or only the Additional Slack Contacts. It starts
 * in Test.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getFeedbackChannelsLive, setFeedbackChannelsLive } from "@/lib/reporting/feedback-channels";

const bodySchema = z.object({ live: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json({ live: await getFeedbackChannelsLive() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await setFeedbackChannelsLive(user.id, parsed.data.live);
  noteAudit({ target: "feedback_channels_settings", targetLabel: parsed.data.live ? "Live" : "Test" });
  return NextResponse.json({ live: await getFeedbackChannelsLive() });
});
