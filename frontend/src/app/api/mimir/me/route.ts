/** What you have told Mimir's coach about yourself: your role and how you like to be coached. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { getProfile, profileSchema, setProfile } from "@/lib/mimir/progress";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json(await getProfile(user.id));
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const parsed = profileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  await setProfile(user.id, parsed.data);
  return NextResponse.json({ ok: true, ...parsed.data });
});
