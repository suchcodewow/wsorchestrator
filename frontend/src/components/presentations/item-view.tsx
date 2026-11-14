"use client";

/** One thing a presentation shows, a slide's picture or one of its own pages, drawn 16:9 to fill the width it is given. */

import { slideImageUrl, type ShowItem } from "@/lib/presentations/live";
import type { RevealState } from "@/lib/presentations/page";
import { cn } from "@/lib/utils";
import { PageView } from "./page-view";

export function ItemView({
  presentationId,
  item,
  reveal,
  onTrigger,
  className,
}: {
  presentationId: string;
  item: ShowItem;
  reveal: RevealState | "all";
  onTrigger?: (elementId: string) => void;
  className?: string;
}) {
  if (item.kind === "page") return <PageView document={item.page.document} state={reveal} onTrigger={onTrigger} className={className} />;
  return (
    <div className={cn("relative aspect-video w-full bg-black", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a slide picture, served by the app's own route */}
      <img
        key={item.id}
        src={slideImageUrl(presentationId, item.slide)}
        alt={`Slide ${item.slide.number}`}
        className="size-full object-contain"
      />
    </div>
  );
}

/** What an item is called beside it: Google's slide number, or "Page" for one of the presentation's own. */
export const itemLabel = (item: ShowItem) => (item.kind === "slide" ? `Slide ${item.slide.number}` : "Page");
