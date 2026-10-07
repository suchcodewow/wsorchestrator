/** The Google meetings, a page at a time, with the connected account and who is on every invite; and adding one. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  createGoogleMeeting,
  googleMeetingsOverview,
  isMeetingWhen,
  listGoogleMeetings,
  meetingInputSchema,
  STATUS_FOR,
} from "@/lib/evals/google-meetings";
import { GOOGLE_MEETING_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const when = params.get("when") ?? "upcoming";
  if (!isMeetingWhen(when)) {
    return NextResponse.json({ error: "invalid_when" }, { status: 400 });
  }
  const query = parseListQuery(params, GOOGLE_MEETING_LIST);
  const [{ rows, page, hasMore }, overview] = await Promise.all([listGoogleMeetings(when, query), googleMeetingsOverview()]);
  return NextResponse.json({ meetings: rows, page, hasMore, ...overview });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = meetingInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await createGoogleMeeting(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.meeting.id, targetLabel: result.meeting.title });
  return NextResponse.json(result.meeting);
});
