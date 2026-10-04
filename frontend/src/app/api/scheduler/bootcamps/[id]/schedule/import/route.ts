/** Filling a bootcamp's schedule from an uploaded copy of the Google Sheet's Schedule tab. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { FILL_STATUS_FOR, importSchedule } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "no_file" }, { status: 400 });
  const file = form.get("file");
  const replace = form.get("replace") === "true";

  const result = await importSchedule(user.id, id.data, file instanceof File ? file : null, replace);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: FILL_STATUS_FOR[result.error] });
  return NextResponse.json(result.summary);
});
