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
import { canManageTrainingSettings } from "@/lib/roles";

const addSchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    stage: z.enum(CANDIDATE_STAGES),
    track: z.enum(COHORT_ADDITION_TRACKS),
  })
  .strict();

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
  const added = await addAttendee(user.id, parsed.data);
  if (!added.ok) {
    return NextResponse.json({ error: added.error, date: added.date ?? null }, { status: STATUS[added.error] });
  }
  noteAudit({ target: added.email, targetLabel: added.fullName });
  return NextResponse.json(added, { status: 201 });
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
