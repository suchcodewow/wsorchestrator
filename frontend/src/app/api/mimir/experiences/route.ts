/** Your finished runs of Coach Canary's hands-on experiences, and recording one more. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { myExperienceProgress, recordExperienceRun } from "@/lib/mimir/experience-progress";
import { EXPERIENCE_NAMES, parseExperienceRun } from "@/lib/mimir/experiences";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({ progress: await myExperienceProgress(user.id) });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const run = parseExperienceRun(await req.json().catch(() => null));
  if (!run) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const progress = await recordExperienceRun(user.id, run);
  noteAudit({
    target: run.part ? `${run.experience}/${run.part}` : run.experience,
    targetLabel: EXPERIENCE_NAMES[run.experience],
    detail: { score: run.score, attempts: progress.attempts, bestScore: progress.bestScore },
  });
  return NextResponse.json({ progress });
});
