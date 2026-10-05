/** A breakout's groups: which of its instructors each attendee goes with, read or replaced whole. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { GROUPS_STATUS_FOR, groupsInputSchema, groupsOf, saveGroups } from "@/lib/scheduler/groups";
import { sessionOf } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string; sessionId: string }> };

async function ids(params: Params["params"]) {
  const { id, sessionId } = await params;
  const bootcamp = idSchema.safeParse(id);
  const session = idSchema.safeParse(sessionId);
  return bootcamp.success && session.success ? { bootcampId: bootcamp.data, sessionId: session.data } : null;
}

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const found = await ids(params);
  if (!found || !(await sessionOf(found.bootcampId, found.sessionId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ groups: await groupsOf(found.sessionId) });
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const found = await ids(params);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = groupsInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveGroups(found.bootcampId, found.sessionId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error, email: result.email }, { status: GROUPS_STATUS_FOR[result.error] });
  return NextResponse.json({ groups: result.groups });
});
