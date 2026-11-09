/** Sends someone in the current cohort their registration form in Slack now, rather than in the next morning's reminders. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { sendRegistrationLink } from "@/lib/cohorts/slack-sync";
import { appBase } from "@/lib/oauth-callback";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z.object({ email: z.string().trim().min(1).max(320) }).strict();

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  noteAudit({ target: parsed.data.email.toLowerCase(), targetLabel: parsed.data.email });
  return NextResponse.json(await sendRegistrationLink(user.id, parsed.data.email, appBase(req)));
});
