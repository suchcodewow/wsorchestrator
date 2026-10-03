/** The bootcamps the Scheduler plans, a page at a time, and scheduling another. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { BOOTCAMP_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { bootcampInputSchema, createBootcamp, listBootcamps } from "@/lib/scheduler/bootcamps";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { rows, page, hasMore } = await listBootcamps(parseListQuery(new URL(req.url).searchParams, BOOTCAMP_LIST));
  return NextResponse.json({ bootcamps: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = bootcampInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const created = await createBootcamp(user.id, parsed.data);
  if (!created.ok) return NextResponse.json({ error: created.error, active: created.active }, { status: 409 });
  return NextResponse.json({ id: created.id }, { status: 201 });
});
