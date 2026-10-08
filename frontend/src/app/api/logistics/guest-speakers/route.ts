/** Adding to and removing from the guest speaker history, the cohorts kept outside the Scheduler. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { addGuestSpeaker, removeGuestSpeaker } from "@/lib/logistics/guest-judges";
import { guestSpeakerSchema } from "@/lib/logistics/guest-judge-values";
import { canManageTrainingSettings } from "@/lib/roles";

export const POST = audited(async function POST(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = guestSpeakerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ target: parsed.data.email ?? parsed.data.fullName, targetLabel: parsed.data.fullName });
  const { added } = await addGuestSpeaker(parsed.data);
  return NextResponse.json({ added }, { status: added ? 201 : 200 });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const cohort = params.get("cohort") ?? "";
  const person = params.get("person") ?? "";
  noteAudit({ target: person, targetLabel: `${person} at ${cohort}` });
  const removed = await removeGuestSpeaker(cohort, person);
  if (removed === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ removed });
});
