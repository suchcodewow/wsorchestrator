/** Who the caller is, what they may do, and their saved preferences. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { preferencesOf, savePreferences } from "@/lib/user-preferences";
import { audited, noteAudit } from "@/lib/audit";
import { chosenNameOnRecord, nameOnRecord, setChosenName } from "@/lib/evals/chosen-names";
import { firstNameOf } from "@/lib/logistics/intake-values";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  return NextResponse.json({
    id: user.id,
    email: user.email,
    access: user.access,
    preferences: await preferencesOf(user.id),
    preferredName: user.email ? await chosenNameOnRecord(user.email) : null,
    nameOnRecord: user.email ? await nameOnRecord(user.email) : null,
  });
}

export const PATCH = audited(async function PATCH(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as {
    themePreference?: unknown;
    calendarScope?: unknown;
    favoriteTabs?: unknown;
    videoLanguage?: unknown;
    preferredName?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { preferredName, ...rest } = body;
  if (preferredName !== undefined) {
    if (typeof preferredName !== "string" || preferredName.length > 100) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    if (!user.email || !(await setChosenName(user.email, preferredName))) {
      return NextResponse.json({ error: "not_an_employee" }, { status: 409 });
    }
    noteAudit({ target: user.id, detail: { preferredName: firstNameOf(preferredName) || null } });
  }

  const result = await savePreferences(user, rest);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : 400 });
  }
  return NextResponse.json({ preferences: await preferencesOf(user.id) });
});
