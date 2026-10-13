/**
 * The front door, for everyone: for someone in Training or Assessments, the
 * steps of running a live training session, each with where it stands now;
 * then Mimir, since everyone can use it. The sidebar has every other page.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Map as MapIcon } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { MimirArt } from "@/components/mimir-art";
import { Button } from "@/components/ui/button";
import { mapSummary } from "@/lib/mimir/map/summary";
import { canSeeLiveTraining, liveTraining } from "@/lib/live-training";
import { canUseMimir, hasNoAccess } from "@/lib/roles";
import { LiveTrainingSteps } from "./live-training";

export const metadata: Metadata = { title: "Welcome" };

const MIMIR_HREF = "/mimir";

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  const { access } = session.user;

  const mimir = canUseMimir(access);
  const [summary, live] = await Promise.all([
    mimir ? mapSummary(session.user.id) : null,
    canSeeLiveTraining(access) ? liveTraining(access) : null,
  ]);
  const firstName = session.user.name?.split(" ")[0];

  return (
    <div className="space-y-10">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Welcome{firstName ? `, ${firstName}` : ""}</h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{session.user.email}</span>
        </p>
      </div>

      {live && <LiveTrainingSteps {...live} />}

      {mimir && (
        <section
          aria-labelledby="welcome-mimir"
          className="grid max-w-3xl overflow-hidden rounded-2xl border bg-card shadow-sm sm:grid-cols-[16rem_minmax(0,1fr)]"
        >
          <Link href={MIMIR_HREF} tabIndex={-1} aria-hidden>
            <MimirArt className="h-full w-full" title="Mimir at the well of wisdom" />
          </Link>
          <div className="flex flex-col justify-center gap-3 p-5">
            <p className="text-xs font-medium tracking-wide text-brand uppercase">Training · open to everyone</p>
            <h2 id="welcome-mimir" className="text-xl font-medium tracking-tight">
              Mimir
            </h2>
            <p className="text-muted-foreground">Learn Harness with Mimir.</p>
            {summary && summary.mastered + summary.watched > 0 && (
              <p className="text-sm text-muted-foreground tnum">
                <span className="font-medium text-foreground">{summary.mastered}</span> of {summary.total} concepts mastered · {summary.watched} of{" "}
                {summary.withVideo} videos watched
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {summary?.next && summary.mastered + summary.watched > 0 ? (
                <>
                  <Button variant="brand" asChild>
                    <Link href="/mimir/chat">
                      Continue: <span className="max-w-56 truncate">{summary.next.name}</span>
                      <ArrowRight />
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/mimir/map">
                      <MapIcon />
                      Open the map
                    </Link>
                  </Button>
                </>
              ) : (
                <Button variant="brand" asChild>
                  <Link href={MIMIR_HREF}>
                    Open Mimir
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {hasNoAccess(access) && !access.judging && !access.manager && (
        <p className="max-w-prose text-sm text-muted-foreground">Other areas open up when an administrator gives you a role.</p>
      )}
    </div>
  );
}
