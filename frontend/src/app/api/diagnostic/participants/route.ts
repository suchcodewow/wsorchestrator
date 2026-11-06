/** The Diagnostic's Participants, a page at a time with their placements; adding one by hand, and taking that away. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { isForm } from "@/lib/iris/engine";
import {
  ADD_PARTICIPANT_STATUS,
  addParticipant,
  getAutoEnroll,
  listParticipants,
  participantCounts,
  removeParticipant,
} from "@/lib/iris/participants";
import { IRIS_PARTICIPANT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";

const emailSchema = z.object({ email: z.string().trim().email().max(320) });

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const form = params.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  const [{ rows, page, hasMore }, counts, autoEnroll] = await Promise.all([
    listParticipants(parseListQuery(params, IRIS_PARTICIPANT_LIST), form),
    participantCounts(),
    getAutoEnroll(),
  ]);
  return NextResponse.json({ people: rows, page, hasMore, counts, autoEnroll });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const parsed = emailSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ targetLabel: parsed.data.email.toLowerCase() });
  const result = await addParticipant(user.id, parsed.data.email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ADD_PARTICIPANT_STATUS[result.error] });
  return NextResponse.json({ ok: true, email: result.email, fullName: result.fullName }, { status: 201 });
});

export const DELETE = audited(async function DELETE(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const parsed = emailSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ targetLabel: parsed.data.email.toLowerCase() });
  const result = await removeParticipant(parsed.data.email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
});
