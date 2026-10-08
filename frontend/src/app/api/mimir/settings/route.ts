/** Mimir's coaching settings: the platform context and the module naming every prompt carries. */

import { NextResponse } from "next/server";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { coachingSettingsSchema, getCoachingSettings, setCoachingSettings } from "@/lib/mimir/settings";

export async function GET(req: Request) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  return NextResponse.json(await getCoachingSettings());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireMimirAdministrator(req);
  if (error) return error;

  const parsed = coachingSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  await setCoachingSettings(user.id, parsed.data);
  return NextResponse.json({ ok: true });
});
