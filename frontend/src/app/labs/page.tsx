import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listLabWorkshops } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";
import { Layers, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Workshops",
  description: "Step-by-step workshops for the sessions run on this site. No account needed.",
};

const updated = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Every workshop. Public — this is the page a room is pointed at.
 *
 * The session is read only to decide whether drafts and the write controls are
 * shown; signed out is the expected case.
 */
export default async function LabsPage() {
  const session = await auth();
  const canEdit = session?.user ? canManageLabGuides(session.user.siteRole) : false;

  const workshops = await listLabWorkshops(canEdit);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Workshops</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Each one is a run of lab guides, in order. Open a workshop and work through it — no account needed.
          </p>
        </div>

        {canEdit && (
          <Button asChild variant="brand" className="shrink-0">
            <Link href="/labs/new">
              <Plus />
              New workshop
            </Link>
          </Button>
        )}
      </div>

      {workshops.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
            <Layers className="size-5" />
          </span>
          <p className="mt-4 text-sm font-medium">No workshops yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {canEdit
              ? "Build the first one — write some guides, then put them in order."
              : "Nothing has been published yet. Check back before your session."}
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3">
          {workshops.map((workshop) => (
            <li key={workshop.id}>
              <Link
                href={`/labs/${workshop.slug}`}
                className="group block rounded-2xl border bg-card/60 dark:bg-card p-5 backdrop-blur-sm transition-colors outline-none hover:border-brand-border/70 hover:bg-accent/40 dark:hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-medium tracking-tight group-hover:text-brand">{workshop.title}</h2>
                  {!workshop.published && (
                    <Badge variant="outline" className="border-dashed">
                      Draft
                    </Badge>
                  )}
                </div>

                {workshop.summary && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{workshop.summary}</p>}

                <p className="mt-3 text-xs text-muted-foreground">
                  {workshop.guideCount === 1 ? "1 guide" : `${workshop.guideCount} guides`}
                  {" · Updated "}
                  {updated.format(workshop.updatedAt)}
                  {workshop.authorName ? ` · ${workshop.authorName}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
        The library, one level down. A guide is reusable material rather than a
        destination, so it is not what this page leads with — but a guide in no
        workshop has to be reachable, and an author needs somewhere to write one
        before there is a workshop to put it in.

      <div className="mt-10 flex items-center justify-between gap-4 rounded-xl border border-dashed p-4">
        <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <BookOpen className="size-4 shrink-0" />
          Every lab guide, including any not yet in a workshop.
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href="/labs/guides">Browse guides</Link>
        </Button>
      </div>
            */}
    </div>
  );
}
