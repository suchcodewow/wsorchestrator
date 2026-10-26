/**
 * Publishes a read deck: its slide pictures replace the map's, and its draft
 * replaces the map, each concept it keeps keeping its video and everyone's
 * progress on it.
 */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { publishDeck } from "@/lib/mimir/studio/publish";

type Params = { params: Promise<{ id: string }> };

const STATUS = { not_found: 404, not_ready: 409, invalid: 409, not_configured: 503 } as const;

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireMimirStudio(req);
  if (error) return error;

  const result = await publishDeck(user.id, (await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  const { diff } = result;
  noteAudit({
    target: result.job.id,
    targetLabel: result.job.label,
    detail: {
      added: diff.added.map((c) => c.id),
      removed: diff.removed.map((c) => c.id),
      changed: diff.changed.map((c) => c.id),
      unchanged: diff.unchanged,
      slides: diff.slides,
    },
  });
  return NextResponse.json({ job: result.job, diff });
});
