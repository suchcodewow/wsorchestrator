import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listCalendarRuns } from "@/lib/runs";
import { WorkshopCalendar } from "./workshop-calendar";

export default async function WorkshopsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const runs = await listCalendarRuns(session.user.id);

  const events = runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    scheduledStart: r.scheduledStart ? r.scheduledStart.toISOString() : null,
    userCount: r.userCount,
    clouds: r.clouds,
  }));

  return <WorkshopCalendar events={events} />;
}
