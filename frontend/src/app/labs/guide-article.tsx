/** One lab guide, rendered. */

import Link from "next/link";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { GuideVariablesPanel } from "@/components/guide-variables-panel";
import { LabGuideBody } from "@/components/lab-guide-body";
import { Button } from "@/components/ui/button";
import { readGuideReader } from "@/lib/guide-values";
import type { LabGuideWithAuthor } from "@/lib/lab-guides";
import type { WorkshopGuideEntry } from "@/lib/lab-workshops";
import { renderMarkdown } from "@/lib/markdown";
import { GuideContents } from "./guide-contents";

const updated = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export type WorkshopContext = {
  slug: string;
  title: string;
  guides: WorkshopGuideEntry[];
  index: number;
  previous: WorkshopGuideEntry | null;
  next: WorkshopGuideEntry | null;
};

export async function GuideArticle({
  guide,
  canEdit,
  context,
}: {
  guide: LabGuideWithAuthor;
  canEdit: boolean;
  context?: WorkshopContext;
}) {
  const reader = await readGuideReader();
  const { html, toc, variables } = await renderMarkdown(guide.body, {
    values: reader.values,
  });

  const showRail = context !== undefined || toc.length >= 3;

  const editHref = `/labs/guides/${guide.slug}/edit`;
  const back = context
    ? { href: `/labs/${context.slug}`, label: context.title }
    : { href: "/labs/guides", label: "All guides" };

  return (
    <div>
      <Link
        href={back.href}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        {back.label}
      </Link>

      <div className="mt-6 flex items-start justify-between gap-6">
        <div>
          {context && (
            <p className="mb-2 text-xs font-medium tracking-wide text-brand uppercase">
              Step {context.index + 1} of {context.guides.length}
            </p>
          )}

          <h1 className="text-3xl font-medium tracking-tight text-balance">
            {guide.title}
          </h1>

          {guide.summary && (
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
              {guide.summary}
            </p>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Updated {updated.format(guide.updatedAt)}
            {guide.authorName ? ` · ${guide.authorName}` : ""}
          </p>
        </div>

        {canEdit && (
          <Button asChild variant="outline" className="shrink-0">
            <Link href={editHref}>
              <Pencil />
              Edit
            </Link>
          </Button>
        )}
      </div>

      <div
        className={
          showRail
            ? "mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start"
            : "mt-10"
        }
      >
        <div>
          <GuideVariablesPanel
            used={variables.used}
            missing={variables.missing}
            values={reader.values}
            provided={reader.provided}
            event={reader.event}
            context={reader.context}
          />

          {html.length > 0 ? (
            <LabGuideBody html={html} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This guide has no content yet.
            </p>
          )}

          {context && (context.previous || context.next) && (
            <nav
              aria-label="Workshop steps"
              className="mt-14 flex items-stretch justify-between gap-4 border-t pt-6"
            >
              {context.previous ? (
                <Link
                  href={`/labs/${context.slug}/${context.previous.slug}`}
                  className="group flex max-w-[45%] flex-col gap-1 rounded-lg border p-3 text-left outline-none transition-colors hover:border-brand-border/70 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowLeft className="size-3.5" />
                    Previous
                  </span>
                  <span className="text-sm font-medium group-hover:text-brand">
                    {context.previous.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}

              {context.next && (
                <Link
                  href={`/labs/${context.slug}/${context.next.slug}`}
                  className="group flex max-w-[45%] flex-col items-end gap-1 rounded-lg border p-3 text-right outline-none transition-colors hover:border-brand-border/70 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Next
                    <ArrowRight className="size-3.5" />
                  </span>
                  <span className="text-sm font-medium group-hover:text-brand">
                    {context.next.title}
                  </span>
                </Link>
              )}
            </nav>
          )}
        </div>

        {showRail && (
          <GuideContents
            toc={toc}
            workshop={
              context
                ? {
                    slug: context.slug,
                    steps: context.guides.map(({ id, slug, title }) => ({
                      id,
                      slug,
                      title,
                    })),
                    index: context.index,
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
