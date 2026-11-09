/**
 * Adding someone to the current cohort by hand, and taking them off again:
 * the Cohorts page's Add attendee, for a one-off attendee its rules leave out.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { COHORT_ADDITION_TRACKS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { addAttendee, removeAttendee, type AddAttendeeError } from "@/lib/cohorts/additions";
import { CANDIDATE_STAGES } from "@/lib/evals/current-cohort";
import { sendRegistrationLink } from "@/lib/cohorts/slack-sync";
import { appBase } from "@/lib/oauth-callback";
import { canManageTrainingSettings } from "@/lib/roles";

const addSchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    stage: z.enum(CANDIDATE_STAGES),
    track: z.enum(COHORT_ADDITION_TRACKS),
    /** On Other: whose sessions they follow, which scores them and invites them once they confirm. */
    follows: z.enum(["sales", "engineer"]).nullable().optional(),
    /** Send them their registration form in Slack now, rather than in the next morning's reminders. */
    notify: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.track !== "other" || !!b.follows, "Other needs the track whose sessions they follow");

const STATUS: Record<AddAttendeeError, number> = {
  not_an_employee: 404,
  already_attended: 409,
  no_bootcamp: 409,
  already_in_cohort: 409,
};

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ target: parsed.data.email.toLowerCase(), targetLabel: parsed.data.email });
  const { notify, ...input } = parsed.data;
  const added = await addAttendee(user.id, input);
  if (!added.ok) {
    return NextResponse.json({ error: added.error, date: added.date ?? null }, { status: STATUS[added.error] });
  }
  noteAudit({ target: added.email, targetLabel: added.fullName });
  const notified = notify ? await sendRegistrationLink(user.id, added.email, appBase(req)) : null;
  return NextResponse.json({ ...added, notified }, { status: 201 });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const email = new URL(req.url).searchParams.get("email")?.trim() ?? "";
  noteAudit({ target: email.toLowerCase(), targetLabel: email });
  const { removed, fullName } = await removeAttendee(email);
  if (!removed) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (fullName) noteAudit({ target: email.toLowerCase(), targetLabel: fullName });
  return NextResponse.json({ ok: true });
});
