/** Who the caller is, what they may do, and their saved preferences. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { preferencesOf, savePreferences } from "@/lib/user-preferences";
import { audited } from "@/lib/audit";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({
    id: user.id,
    email: user.email,
    access: user.access,
    preferences: await preferencesOf(user.id),
  });
}

export const PATCH = audited(async function PATCH(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as {
    themePreference?: unknown;
    calendarScope?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await savePreferences(user, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "forbidden" ? 403 : 400 },
    );
  }
  return NextResponse.json({ preferences: await preferencesOf(user.id) });
});
