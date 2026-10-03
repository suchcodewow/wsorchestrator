/** The deferral window: how close to the next bootcamp someone can start and still be expected at it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { DEFERRAL_DAYS_LIMITS } from "@/db/schema";
import { getDeferralDays, setDeferralDays } from "@/lib/evals/settings";
import { nextBootcampStart, retrackOrg } from "@/lib/evals/tracks";

const bodySchema = z
  .object({ days: z.number().int().min(DEFERRAL_DAYS_LIMITS.min).max(DEFERRAL_DAYS_LIMITS.max) })
  .strict();

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  const [days, bootcampStart] = await Promise.all([getDeferralDays(), nextBootcampStart()]);
  return NextResponse.json({ days, bootcampStart });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ target: "deferral-days", targetLabel: "Deferral window" });
  await setDeferralDays(user.id, parsed.data.days);
  const retracked = await retrackOrg();
  noteAudit({ detail: { days: parsed.data.days, retracked } });
  const [days, bootcampStart] = await Promise.all([getDeferralDays(), nextBootcampStart()]);
  return NextResponse.json({ days, bootcampStart, retracked });
});
