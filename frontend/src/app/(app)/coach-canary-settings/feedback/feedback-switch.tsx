/**
 * The two kinds of feedback Coach Canary Feedback shows, one at a time: on
 * the concept videos, or on the slide review's slides. Each is a link, so the
 * page fetches only what it shows and a reload keeps the choice; switching
 * starts the other list from its first page, unsorted and unsearched.
 */

import Link from "next/link";
import { Clapperboard, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedbackKind = "videos" | "slides";

/** The address for each kind; videos is the tab's own address, so it is the default. */
const HREF: Record<FeedbackKind, string> = {
  videos: "/coach-canary-settings/feedback",
  slides: "/coach-canary-settings/feedback?view=slides",
};

const BUTTONS = [
  { kind: "videos", label: "Video Feedback", Icon: Clapperboard },
  { kind: "slides", label: "Slide Game Feedback", Icon: Presentation },
] as const;

export const feedbackKindOf = (view: string | string[] | undefined): FeedbackKind => (view === "slides" ? "slides" : "videos");

export function FeedbackSwitch({ current }: { current: FeedbackKind }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Kind of feedback">
      {BUTTONS.map(({ kind, label, Icon }) => {
        const on = kind === current;
        return (
          <Link
            key={kind}
            href={HREF[kind]}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              on
                ? "border-brand-border bg-brand-subtle text-foreground"
                : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
