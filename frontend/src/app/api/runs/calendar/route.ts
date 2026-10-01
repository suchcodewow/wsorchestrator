/**
 * The events calendar, as the Events page shows it: your own events, or
 * everyone's for those who may see them. `?scope=own|all` overrides the saved
 * calendar scope.
 */

import { NextResponse } from "next/server";
import { CALENDAR_SCOPES, type CalendarScope } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { canSeeAllEvents, canUseEvents } from "@/lib/roles";
import { listCalendarRuns } from "@/lib/runs";
import { preferencesOf } from "@/lib/user-preferences";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canUseEvents);
  if (error) return error;

  const asked = new URL(req.url).searchParams.get("scope");
  if (asked !== null && !CALENDAR_SCOPES.includes(asked as CalendarScope)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  if (asked === "all" && !canSeeAllEvents(user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const saved = (await preferencesOf(user.id)).calendarScope;
  const scope: CalendarScope =
    (asked as CalendarScope | null) ?? (canSeeAllEvents(user.access) ? saved : "own");

  return NextResponse.json({ scope, runs: await listCalendarRuns(user, scope) });
}
