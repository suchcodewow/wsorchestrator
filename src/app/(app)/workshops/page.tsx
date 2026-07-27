import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { workshops } from "@/db/schema";
import { auth } from "@/auth";
import { listCalendarRuns } from "@/lib/runs";
import { WorkshopCalendar } from "./workshop-calendar";

export default async function WorkshopsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const [library, runs] = await Promise.all([
    db.query.workshops.findMany({
      where: eq(workshops.enabled, true),
      orderBy: asc(workshops.title),
      columns: { id: true, title: true },
    }),
    listCalendarRuns(session.user.id),
  ]);

  const events = runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    scheduledStart: r.scheduledStart ? r.scheduledStart.toISOString() : null,
    workshopTitle: r.workshopTitle,
  }));

  return <WorkshopCalendar library={library} events={events} />;
}
