/** The assessments eVals administrators define, a page at a time, and creating one. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  ASSESSMENT_STATUS_FOR,
  assessmentCount,
  assessmentSchema,
  createAssessment,
  listAssessments,
} from "@/lib/evals/assessments";
import { ASSESSMENT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, ASSESSMENT_LIST);
  const [{ rows, page, hasMore }, total] = await Promise.all([listAssessments(query), assessmentCount()]);
  return NextResponse.json({ assessments: rows, page, hasMore, total });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = assessmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await createAssessment(user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ASSESSMENT_STATUS_FOR[result.error] });
  }
  noteAudit({ target: result.id, targetLabel: result.name });
  return NextResponse.json({ id: result.id });
});
