/** The HiBob start date and active effective date cutoffs on who counts as a candidate. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { isIsoDay } from "@/lib/evals/history-values";
import { getCandidateCutoffs, setCandidateCutoffs } from "@/lib/evals/settings";
import { audited, noteAudit } from "@/lib/audit";

const cutoff = z.string().refine(isIsoDay, "not a YYYY-MM-DD day").nullable().optional();
const bodySchema = z
  .object({ startDateOnOrAfter: cutoff, activeEffectiveDateAfter: cutoff })
  .strict()
  .refine((b) => b.startDateOnOrAfter !== undefined || b.activeEffectiveDateAfter !== undefined);

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json(await getCandidateCutoffs());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  noteAudit({ target: "candidate-cutoffs", targetLabel: "Candidate cutoffs" });
  await setCandidateCutoffs(user.id, parsed.data);
  return NextResponse.json(await getCandidateCutoffs());
});
