/** Throws away a deck's draft, or a deck that never finished uploading or failed, with its file. */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { discardDeck } from "@/lib/mimir/studio/publish";

type Params = { params: Promise<{ id: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error } = await requireMimirStudio(req);
  if (error) return error;

  const result = await discardDeck((await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  noteAudit({ target: result.job.id, targetLabel: result.job.label });
  return NextResponse.json({ job: result.job });
});
