import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canSeeAllEvents } from "@/lib/roles";
import { listCalendarRuns } from "@/lib/runs";
import { getUserPreferences } from "@/lib/user-preferences";
import { EventCalendar } from "./event-calendar";

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const role = session.user.siteRole;
  const { calendarScope } = await getUserPreferences();
  // A manager who was demoted keeps the saved preference but not the view.
  const scope = canSeeAllEvents(role) ? calendarScope : "own";

  const runs = await listCalendarRuns({ id: session.user.id, role }, scope);

  const events = runs.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    status: r.status,
    scheduledStart: r.scheduledStart ? r.scheduledStart.toISOString() : null,
    userCount: r.userCount,
    clouds: r.clouds,
    // Only shown at `all` scope, where the room the event belongs to is the
    // one thing the owner's own calendar never has to say.
    owner:
      r.ownerId === session.user.id
        ? null
        : (r.ownerName ?? r.ownerEmail ?? "Unknown"),
  }));

  return <EventCalendar events={events} scope={scope} />;
}
