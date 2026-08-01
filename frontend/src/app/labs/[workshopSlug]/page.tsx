import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLabWorkshopBySlug } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";

const updated = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

async function viewerCanEdit(): Promise<boolean> {
  const session = await auth();
  return session?.user ? canManageLabGuides(session.user.siteRole) : false;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workshopSlug: string }>;
}): Promise<Metadata> {
  const { workshopSlug } = await params;
  const workshop = await getLabWorkshopBySlug(workshopSlug, await viewerCanEdit());
  if (!workshop) return { title: "Workshop" };

  return {
    title: workshop.title,
    description: workshop.summary || undefined,
    ...(workshop.published ? {} : { robots: { index: false, follow: false } }),
  };
}

/** One workshop: what it covers, and the guides it is made of, in order. */
export default async function WorkshopPage({
  params,
}: {
  params: Promise<{ workshopSlug: string }>;
}) {
  const { workshopSlug } = await params;
  const canEdit = await viewerCanEdit();

  const workshop = await getLabWorkshopBySlug(workshopSlug, canEdit);
  if (!workshop) notFound();

  const first = workshop.guides[0];

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
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-medium tracking-tight text-balance">
              {workshop.title}
            </h1>
            {!workshop.published && (
              <Badge variant="outline" className="border-dashed">
                Draft
              </Badge>
            )}
          </div>

          {workshop.summary && (
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
              {workshop.summary}
            </p>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            {workshop.guides.length === 1
              ? "1 guide"
              : `${workshop.guides.length} guides`}
            {" · Updated "}
            {updated.format(workshop.updatedAt)}
            {workshop.authorName ? ` · ${workshop.authorName}` : ""}
          </p>
        </div>

        {canEdit && (
          <Button asChild variant="outline" className="shrink-0">
            <Link href={`/labs/${workshop.slug}/edit`}>
              <Pencil />
              Edit
            </Link>
          </Button>
        )}
      </div>

      {first && (
        <Button asChild variant="brand" size="lg" className="group mt-8">
          <Link href={`/labs/${workshop.slug}/${first.slug}`}>
            Start the workshop
            <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </Button>
      )}

      <h2 className="mt-10 text-sm font-medium">Contents</h2>

      {workshop.guides.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {canEdit
            ? "Nothing in this workshop yet — add some guides to it."
            : "This workshop has no published guides yet."}
        </p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {workshop.guides.map((guide, i) => (
            <li key={guide.id}>
              <Link
                href={`/labs/${workshop.slug}/${guide.slug}`}
                className="group flex items-baseline gap-3 rounded-xl border bg-card/60 p-4 transition-colors outline-none hover:border-brand-border/70 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="tnum text-sm text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium group-hover:text-brand">
                      {guide.title}
                    </span>
                    {!guide.published && (
                      <Badge variant="outline" className="border-dashed">
                        Draft
                      </Badge>
                    )}
                  </span>
                  {guide.summary && (
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                      {guide.summary}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
