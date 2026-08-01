import Link from "next/link";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { LabGuideBody } from "@/components/lab-guide-body";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LabGuideWithAuthor } from "@/lib/lab-guides";
import type { WorkshopGuideEntry } from "@/lib/lab-workshops";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

const updated = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The workshop a guide is being read inside, when it is being read inside one.
 *
 * A guide belongs to any number of workshops, so "which one am I in?" is a
 * property of the URL rather than of the guide — everything positional here
 * (the step count, the neighbours, the contents rail) comes from this and not
 * from the row.
 */
export type WorkshopContext = {
  slug: string;
  title: string;
  guides: WorkshopGuideEntry[];
  index: number;
  previous: WorkshopGuideEntry | null;
  next: WorkshopGuideEntry | null;
};

/**
 * One lab guide, rendered.
 *
 * Shared by `/labs/guides/<guide>` and `/labs/<workshop>/<guide>` so the two
 * cannot drift into two different-looking readers of the same document. The
 * only difference between them is `context`, and everything it changes is
 * navigation — never the guide itself.
 */
export async function GuideArticle({
  guide,
  canEdit,
  context,
}: {
  guide: LabGuideWithAuthor;
  canEdit: boolean;
  context?: WorkshopContext;
}) {
  const { html, toc } = await renderMarkdown(guide.body);

  // In a workshop the rail is the workshop; on its own, a long guide gets a
  // list of its own headings. Below three headings that list is longer than
  // the thing it indexes.
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

          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-medium tracking-tight text-balance">
              {guide.title}
            </h1>
            {!guide.published && (
              <Badge variant="outline" className="border-dashed">
                Draft
              </Badge>
            )}
          </div>

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
          // Second in the DOM so the guide itself is what a screen reader and a
          // narrow viewport reach first.
          <nav
            aria-label={context ? "Workshop contents" : "On this page"}
            className="hidden text-sm lg:sticky lg:top-20 lg:block"
          >
            {context ? (
              <>
                <p className="font-medium">Contents</p>
                <ol className="mt-3 grid gap-1 border-l">
                  {context.guides.map((entry, i) => {
                    const current = i === context.index;
                    return (
                      <li key={entry.id}>
                        <Link
                          href={`/labs/${context.slug}/${entry.slug}`}
                          aria-current={current ? "page" : undefined}
                          className={cn(
                            "-ml-px flex gap-2 border-l py-1 pl-4 leading-snug outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            current
                              ? "border-brand font-medium text-brand"
                              : "border-transparent text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span className="tnum opacity-60">{i + 1}.</span>
                          <span>{entry.title}</span>
                        </Link>

                        {/* The current step's own headings, nested under it —
                            one rail for both scales of navigation. */}
                        {current && toc.length >= 2 && (
                          <ul className="mt-1 mb-1 grid gap-1">
                            {toc.map((heading) => (
                              <li key={heading.id}>
                                <a
                                  href={`#${heading.id}`}
                                  className={cn(
                                    "block rounded-md py-0.5 text-[13px] leading-snug text-muted-foreground outline-none transition-colors hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                    heading.depth === 3 ? "pl-11" : "pl-8",
                                  )}
                                >
                                  {heading.text}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <>
                <p className="font-medium">On this page</p>
                <ul className="mt-3 grid gap-2 border-l pl-4">
                  {toc.map((entry) => (
                    <li key={entry.id} className={entry.depth === 3 ? "pl-3" : ""}>
                      <a
                        href={`#${entry.id}`}
                        className="block rounded-md leading-snug text-muted-foreground outline-none transition-colors hover:text-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {entry.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
