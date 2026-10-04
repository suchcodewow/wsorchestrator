/** The facilities bootcamps are held at, a page at a time, and adding one with its rooms. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { FACILITY_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { FACILITY_STATUS_FOR, createFacility, facilityInputSchema, listFacilities } from "@/lib/scheduler/facilities";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { rows, page, hasMore } = await listFacilities(parseListQuery(new URL(req.url).searchParams, FACILITY_LIST));
  return NextResponse.json({ facilities: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = facilityInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const created = await createFacility(user.id, parsed.data);
  if (!created.ok) {
    return NextResponse.json({ error: created.error, room: created.room }, { status: FACILITY_STATUS_FOR[created.error] });
  }
  return NextResponse.json({ id: created.id }, { status: 201 });
});
