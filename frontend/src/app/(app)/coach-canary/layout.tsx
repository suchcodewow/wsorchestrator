/**
 * The layout for Mimir: a coach that walks you through the course, the map
 * of the course, a library of the video for each concept, and hands-on experiences,
 * such as a pretend code change from branch to merge. Open to everyone signed in.
 * What you have mastered and watched is yours, and kept between visits.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { mapSummary } from "@/lib/mimir/map/summary";
import { canUseMimir } from "@/lib/roles";
import { MimirTabs } from "./mimir-tabs";

export const metadata: Metadata = { title: "Coach Canary" };

export default async function MimirLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseMimir(session.user.access)) notFound();

  const summary = await mapSummary(session.user.id);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-medium tracking-tight">Coach Canary</h1>
          {summary && (
            <p className="text-sm text-muted-foreground tnum">
              <span className="font-medium text-foreground">{summary.mastered}</span> of {summary.total} concepts mastered ·{" "}
              {summary.watched} of {summary.withVideo} videos watched
            </p>
          )}
        </div>
      </div>
      <MimirTabs />
      {children}
    </div>
  );
}
