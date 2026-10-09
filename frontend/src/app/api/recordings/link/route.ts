/** The recording link in use, and replacing it with a new one. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getActiveLink, replaceLink } from "@/lib/recording/recordings";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  return NextResponse.json({ link: await getActiveLink() });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const link = await replaceLink(user.id);
  noteAudit({ target: link.id, targetLabel: "recording link" });
  return NextResponse.json({ link }, { status: 201 });
});
