/** Whether the Diagnostic's Slack reminders are sent, or every run is a dry run. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getRemindersLive, setRemindersLive } from "@/lib/iris/reminders";
import { canManageIris } from "@/lib/roles";

const bodySchema = z.object({ live: z.boolean() }).strict();

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  noteAudit({ targetLabel: parsed.data.live ? "Diagnostic reminders live" : "Diagnostic reminders dry run" });
  await setRemindersLive(user.id, parsed.data.live);
  return NextResponse.json({ live: await getRemindersLive() });
});
