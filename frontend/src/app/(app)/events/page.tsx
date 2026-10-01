/** The events calendar page. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canSeeAllEvents, canUseEvents, homePath } from "@/lib/roles";
import { listCalendarRuns } from "@/lib/runs";
import { getUserPreferences } from "@/lib/user-preferences";
import { EventCalendar } from "./event-calendar";

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const access = session.user.access;
  // Where sign-in and the front page land everyone, so it is also what sends
  // someone without event access on to the area they do have.
  if (!canUseEvents(access)) redirect(homePath(access));

  const { calendarScope } = await getUserPreferences();
  const scope = canSeeAllEvents(access) ? calendarScope : "own";

  const runs = await listCalendarRuns({ id: session.user.id, access }, scope);

  const events = runs.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    status: r.status,
    scheduledStart: r.scheduledStart ? r.scheduledStart.toISOString() : null,
    ttlSeconds: r.ttlSeconds,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    userCount: r.userCount,
    clouds: r.clouds,
    owner:
      r.ownerId === session.user.id
        ? null
        : (r.ownerName ?? r.ownerEmail ?? "Unknown"),
  }));

  return <EventCalendar events={events} />;
}
