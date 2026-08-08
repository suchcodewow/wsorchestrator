import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen, Plus } from "lucide-react";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { listLabGuides } from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Lab guides",
  description: "Every individual lab guide, across all workshops.",
};

const updated = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The library: every guide, whichever workshops it belongs to.
 *
 * Public, like the workshops that assemble them, and public in full — a guide
 * has no published state of its own, so this lists the lot. A guide is reusable
 * material rather than a destination, so this is a level below `/labs` — but it
 * is the only way to reach a guide that no workshop has picked up yet, and the
 * only place to write one before there is a workshop to put it in.
 *
 * The session is read only to decide whether the write controls are shown.
 */
export default async function GuideLibraryPage() {
  const session = await auth();
  const canEdit = session?.user
    ? canManageLabGuides(session.user.siteRole)
    : false;

  const guides = await listLabGuides();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/labs"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        All workshops
      </Link>

      <div className="mt-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Lab guides</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Every guide there is. Each one can sit in any number of workshops —
            it is written and edited here, once.
          </p>
        </div>

        {canEdit && (
          <Button asChild variant="brand" className="shrink-0">
            <Link href="/labs/guides/new">
              <Plus />
              New guide
            </Link>
          </Button>
        )}
      </div>

      {guides.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
            <BookOpen className="size-5" />
          </span>
          <p className="mt-4 text-sm font-medium">No guides yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {canEdit
              ? "Write the first one, then put it in a workshop."
              : "Nothing has been written yet. Check back before your session."}
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3">
          {guides.map((guide) => (
            <li key={guide.id}>
              <Link
                href={`/labs/guides/${guide.slug}`}
                className="group block rounded-2xl border bg-card/60 p-5 backdrop-blur-sm transition-colors outline-none hover:border-brand-border/70 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <h2 className="text-base font-medium tracking-tight group-hover:text-brand">
                  {guide.title}
                </h2>

                {guide.summary && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {guide.summary}
                  </p>
                )}

                <p className="mt-3 text-xs text-muted-foreground">
                  Updated {updated.format(guide.updatedAt)}
                  {guide.authorName ? ` · ${guide.authorName}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
