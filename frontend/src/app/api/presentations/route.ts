/** Every presentation, a page at a time, and adding one from a Google Slides link. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { PRESENTATION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { createPresentationSchema, PRESENTATION_STATUS } from "@/lib/presentations/input";
import { slidesFileId } from "@/lib/presentations/link";
import { createPresentation, listPresentations } from "@/lib/presentations/presentations";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { rows, page, hasMore } = await listPresentations(parseListQuery(new URL(req.url).searchParams, PRESENTATION_LIST));
  return NextResponse.json({ presentations: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = createPresentationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const result = await createPresentation({ name: parsed.data.name, googleFileId: slidesFileId(parsed.data.link)!, createdBy: user.id });
  if (!result.ok) return NextResponse.json({ error: result.error, message: result.message }, { status: PRESENTATION_STATUS[result.error] });
  noteAudit({ target: result.id, targetLabel: parsed.data.name });
  return NextResponse.json({ id: result.id, slides: result.slides }, { status: 201 });
});
