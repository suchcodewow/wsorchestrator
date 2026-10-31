/**
 * The people the Google Meetings sync adds to each occurrence a cohort member
 * is on. PUT replaces the list; the next live sync adds whoever joined it and
 * takes off whoever left.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { MEETING_ADMINISTRATORS_MAX } from "@/db/schema";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMeetingAdministrators, setMeetingAdministrators } from "@/lib/evals/google-meetings";

const bodySchema = z
  .object({
    administrators: z
      .array(z.object({ email: z.string().trim().toLowerCase().email().max(320), fullName: z.string().trim().max(200) }).strict())
      .max(MEETING_ADMINISTRATORS_MAX),
  })
  .strict();

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json({ administrators: await getMeetingAdministrators() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const before = await getMeetingAdministrators();
  const administrators = await setMeetingAdministrators(user.id, parsed.data.administrators);
  noteAudit({
    target: "google_meetings_administrators",
    targetLabel: "Assessments Administrators",
    detail: { was: before.map((a) => a.email), now: administrators.map((a) => a.email) },
  });
  return NextResponse.json({ administrators });
});
