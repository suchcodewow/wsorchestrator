/** The participation descriptors and the net marks each score starts at. */

import { NextResponse } from "next/server";
import { requireCaller, requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  SETTINGS_STATUS_FOR,
  participationSettings,
  participationSettingsSchema,
  saveParticipationSettings,
} from "@/lib/evals/participation";
import { canManageEvalsSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json(await participationSettings());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageEvalsSettings);
  if (error) return error;

  const parsed = participationSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveParticipationSettings(user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SETTINGS_STATUS_FOR[result.error] });

  noteAudit({
    target: "participation",
    targetLabel: "Participation settings",
    detail: { descriptors: result.settings.descriptors.length, bands: result.settings.bands },
  });
  return NextResponse.json(result.settings);
});
