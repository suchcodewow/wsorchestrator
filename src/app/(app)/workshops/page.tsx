import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Clock } from "lucide-react";
import { db } from "@/db";
import { workshops } from "@/db/schema";
import { auth } from "@/auth";
import { listRunsForUser } from "@/lib/runs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LaunchButton } from "./launch-button";

export default async function WorkshopsPage() {
  const session = await auth();
  const [library, recentRuns] = await Promise.all([
    db.query.workshops.findMany({
      where: eq(workshops.enabled, true),
      orderBy: desc(workshops.createdAt),
    }),
    listRunsForUser(session!.user.id),
  ]);

  return (
    <div className="space-y-10">
      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workshop library</h1>
        <p className="text-muted-foreground">
          Pick a workshop to provision a dedicated, ephemeral Google Cloud
          environment. Each run auto-destroys when its TTL expires.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {library.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No workshops yet. Run <code>npm run db:seed</code> to load samples.
          </p>
        )}
        {library.map((w) => (
          <Card key={w.id} className="flex flex-col">
            <CardHeader>
              <CardTitle>{w.title}</CardTitle>
              <CardDescription>{w.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4" />
              TTL {Math.round(w.ttlSeconds / 60)} min
            </CardContent>
            <CardFooter>
              <LaunchButton workshopId={w.id} />
            </CardFooter>
          </Card>
        ))}
      </section>

      {recentRuns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Your recent runs</h2>
          <div className="divide-y rounded-lg border">
            {recentRuns.slice(0, 8).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50"
              >
                <span className="font-mono text-sm text-muted-foreground">
                  {run.gcpProjectId ?? run.id.slice(0, 8)}
                </span>
                <StatusBadge status={run.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
