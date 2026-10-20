/** The meetings picked from the Revenue Enablement calendar, a page at a time, with the sync's state; and picking one. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  createMeetingSelection,
  googleMeetingsOverview,
  listMeetingSelections,
  meetingSelectionSchema,
  STATUS_FOR,
} from "@/lib/evals/google-meetings";
import { MEETING_SELECTION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, MEETING_SELECTION_LIST);
  const [{ rows, page, hasMore }, overview] = await Promise.all([listMeetingSelections(query), googleMeetingsOverview()]);
  return NextResponse.json({ meetings: rows, page, hasMore, ...overview });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = meetingSelectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await createMeetingSelection(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.meeting.id, targetLabel: result.meeting.name, detail: { stage: parsed.data.stage, track: parsed.data.track } });
  return NextResponse.json(result.meeting);
});
