/** An Assessments Administrator's correction to someone's bootcamp history row: its days and scores, never whose it is. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { STATUS_FOR, historyCorrectionSchema } from "@/lib/evals/bootcamp-history";
import { correctHistory } from "@/lib/reporting/bootcamp";
import { canManageBootcampRecords } from "@/lib/roles";

const idSchema = z.string().uuid();

export const PATCH = audited(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = historyCorrectionSchema.strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await correctHistory(user.id, id.data, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  noteAudit({ target: id.data, targetLabel: result.email, detail: { fields: Object.keys(parsed.data) } });
  return NextResponse.json({ ok: true });
});
