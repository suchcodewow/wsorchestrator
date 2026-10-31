/**
 * The people the Google Meetings sync adds to each occurrence a cohort member
 * is on. PUT replaces the list; the next live sync adds whoever joined it and
 * takes off whoever left.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { MEETING_FACILITATORS_MAX } from "@/db/schema";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMeetingFacilitators, setMeetingFacilitators } from "@/lib/evals/google-meetings";

const bodySchema = z
  .object({
    facilitators: z
      .array(z.object({ email: z.string().trim().toLowerCase().email().max(320), fullName: z.string().trim().max(200) }).strict())
      .max(MEETING_FACILITATORS_MAX),
  })
  .strict();

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json({ facilitators: await getMeetingFacilitators() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const before = await getMeetingFacilitators();
  const facilitators = await setMeetingFacilitators(user.id, parsed.data.facilitators);
  noteAudit({
    target: "google_meetings_facilitators",
    targetLabel: "Meeting facilitators",
    detail: { was: before.map((a) => a.email), now: facilitators.map((a) => a.email) },
  });
  return NextResponse.json({ facilitators });
});
