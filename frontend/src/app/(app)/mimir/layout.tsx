/**
 * The layout for Mimir: a coach that walks you through the course, and the map
 * of the course with a video for each concept. Open to everyone signed in.
 * What you have mastered and watched is yours, and kept between visits.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Archive } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { Button } from "@/components/ui/button";
import { mapSummary } from "@/lib/mimir/map/summary";
import { canManageMimir, canUseMimir } from "@/lib/roles";
import { MimirTabs } from "./mimir-tabs";

export const metadata: Metadata = { title: "Mimir" };

export default async function MimirLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseMimir(session.user.access)) notFound();

  const summary = await mapSummary(session.user.id);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-medium tracking-tight">Mimir</h1>
          {summary && (
            <p className="text-sm text-muted-foreground tnum">
              <span className="font-medium text-foreground">{summary.mastered}</span> of {summary.total} concepts mastered ·{" "}
              {summary.watched} of {summary.withVideo} videos watched
            </p>
          )}
        </div>
        {canManageMimir(session.user.access) && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/mimir-archive">
              <Archive />
              Archive
            </Link>
          </Button>
        )}
      </div>
      <MimirTabs />
      {children}
    </div>
  );
}
