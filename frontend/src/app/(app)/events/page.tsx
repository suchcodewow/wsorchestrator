import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listCalendarRuns } from "@/lib/runs";
import { EventCalendar } from "./event-calendar";

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const runs = await listCalendarRuns(session.user.id);

  const events = runs.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    status: r.status,
    scheduledStart: r.scheduledStart ? r.scheduledStart.toISOString() : null,
    userCount: r.userCount,
    clouds: r.clouds,
  }));

  return <EventCalendar events={events} />;
}
