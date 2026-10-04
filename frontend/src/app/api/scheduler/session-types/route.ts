/** The session types that start a new session, a page at a time, and adding one. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { SESSION_TYPE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { SESSION_TYPE_STATUS_FOR, createSessionType, listSessionTypes, sessionTypeInputSchema } from "@/lib/scheduler/session-types";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { rows, page, hasMore } = await listSessionTypes(parseListQuery(new URL(req.url).searchParams, SESSION_TYPE_LIST));
  return NextResponse.json({ sessionTypes: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = sessionTypeInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const created = await createSessionType(user.id, parsed.data);
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: SESSION_TYPE_STATUS_FOR[created.error] });
  return NextResponse.json(created.type, { status: 201 });
});
