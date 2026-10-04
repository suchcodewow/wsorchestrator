/** One assessment: reading it, replacing its fields and criteria, or removing it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  ASSESSMENT_STATUS_FOR,
  assessmentSchema,
  deleteAssessment,
  getAssessment,
  updateAssessment,
} from "@/lib/evals/assessments";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const assessment = id.success ? await getAssessment(id.data) : null;
  if (!assessment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(assessment);
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = assessmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateAssessment(id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ASSESSMENT_STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.id, targetLabel: result.name });
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await deleteAssessment(id.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ASSESSMENT_STATUS_FOR[result.error] });
  }
  noteAudit({ target: id.data, targetLabel: result.name });
  return NextResponse.json({ ok: true });
});
