/** The bootcamps the Scheduler plans, a page at a time, and scheduling another with its judges. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { BOOTCAMP_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { BOOTCAMP_STATUS_FOR, bootcampInputSchema, createBootcamp, listBootcamps } from "@/lib/scheduler/bootcamps";

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
  if (!created.ok) {
    const { error, active, email } = created;
    return NextResponse.json({ error, active, email }, { status: BOOTCAMP_STATUS_FOR[error] });
  }
  return NextResponse.json({ id: created.id }, { status: 201 });
});
