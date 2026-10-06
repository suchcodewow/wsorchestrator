/**
 * The Canary Wire's pull from Mindtickle: how the newest one stands, and
 * Refresh, which starts one. Starting does no fetching; `POST …/pull/step`
 * does, a few minutes at a time.
 */

import { NextResponse } from "next/server";
import { requireCanaryWire } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { mindtickleConfig } from "@/lib/canary-wire/mindtickle";
import { latestPull, startPull } from "@/lib/canary-wire/pull";

export async function GET(req: Request) {
  const { error } = await requireCanaryWire(req);
  if (error) return error;
  return NextResponse.json({ configured: mindtickleConfig() !== null, pull: await latestPull() }, { headers: { "cache-control": "no-store" } });
}

const STATUS = { not_configured: 409, running: 409 } as const;

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCanaryWire(req);
  if (error) return error;
  const started = await startPull("manual", user.id);
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: STATUS[started.error] });
  noteAudit({ target: started.pull.id, targetLabel: "Canary Wire pull from Mindtickle" });
  return NextResponse.json({ pull: started.pull });
});
