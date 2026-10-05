/**
 * Works on the running Canary Wire pull for up to four minutes, then answers
 * with how it stands. The page calls it again until the pull ends; a call
 * while another step holds the pull just answers. Does nothing when no pull
 * is running.
 */

import { NextResponse } from "next/server";
import { requireCanaryWire } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { advancePull } from "@/lib/canary-wire/pull";

export const maxDuration = 300;

export const POST = audited(async function POST(req: Request) {
  const { error } = await requireCanaryWire(req);
  if (error) return error;
  const pull = await advancePull();
  if (pull) noteAudit({ target: pull.id, targetLabel: "Canary Wire pull from Mindtickle", detail: { status: pull.status, done: pull.done, total: pull.total } });
  return NextResponse.json({ pull });
});
