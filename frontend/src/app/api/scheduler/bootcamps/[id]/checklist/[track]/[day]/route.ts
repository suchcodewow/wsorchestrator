/** One day of one class's checklist, whole, both AM and PM, and adding to either half. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { bootcampExists } from "@/lib/scheduler/bootcamps";
import {
  CHECKLIST_STATUS_FOR,
  addChecklistItem,
  checklistDaySchema,
  checklistItemSchema,
  checklistTrackSchema,
  listDayItems,
} from "@/lib/scheduler/checklist";

const paramsSchema = z.object({ id: z.string().uuid(), track: checklistTrackSchema, day: checklistDaySchema });

type Params = { params: Promise<{ id: string; track: string; day: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success || !(await bootcampExists(parsed.data.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { id, track, day } = parsed.data;
  return NextResponse.json({ items: await listDayItems(id, track, day) });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const input = checklistItemSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { id, track, day } = parsed.data;
  const result = await addChecklistItem(user.id, id, track, day, input.data);
  if (!result.ok) {
    return NextResponse.json(
      result.email ? { error: result.error, email: result.email } : { error: result.error },
      { status: CHECKLIST_STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json(result.value, { status: 201 });
});
