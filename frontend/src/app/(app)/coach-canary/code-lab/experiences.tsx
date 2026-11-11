"use client";

/**
 * Mimir's hands-on experiences: short, pretend stretches of someone's job,
 * listed one to a row. Each opens in a window that fills the browser, the way
 * Mimir's videos do. Nothing is kept: closing the window ends the run, and
 * opening it again starts over.
 */

import { useState, type ReactNode } from "react";
import { ChevronRight, Infinity as InfinityIcon, Laptop, Presentation, ShieldAlert, Timer, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CodeLabView } from "./code-lab-view";
import { SecurityTeamView } from "./security-team-view";
import { SlideReviewView } from "./slide-review-view";

type Experience = {
  id: string;
  name: string;
  summary: string;
  minutes: string;
  /** Drawn beside `minutes`: a clock unless the experience has no end. */
  MinutesIcon?: LucideIcon;
  Icon: LucideIcon;
  /** The experience itself, for the person signed in. */
  render: (author: string) => ReactNode;
  /** Uses the window's whole width rather than the reading column, for a slide read at the largest size the screen allows. */
  wide?: boolean;
};

const EXPERIENCES: Experience[] = [
  {
    id: "developer",
    name: "Day in the Life: Developer",
    summary:
      "Pick up a ticket at the Greenleaf Shop and take it all the way to production: change the code, commit, push, open a pull request and merge it.",
    minutes: "5–7 minutes",
    Icon: Laptop,
    render: (author) => <CodeLabView author={author} />,
  },
  {
    id: "security",
    name: "Day in the Life: Enterprise Security Team",
    summary:
      "Join Globalcorp’s enterprise security team. Experience the real-world challenge of how so many companies try to secure software releases by hand. Comes with a free quarter-end performance review!",
    minutes: "8–10 minutes",
    Icon: ShieldAlert,
    render: () => <SecurityTeamView />,
  },
  {
    id: "slide-review",
    name: "Ready to sharpen your slide critiquing skills?",
    summary:
      "The sales team has been hard at work creating “Our understanding” slides for upcoming opportunities. Help them by reviewing their slides for spelling, grammar and formatting.",
    minutes: "Until you give up",
    MinutesIcon: InfinityIcon,
    Icon: Presentation,
    render: () => <SlideReviewView />,
    wide: true,
  },
];

export function ExperiencesView({ author }: { author: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = EXPERIENCES.find((e) => e.id === openId);

  return (
    <>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {EXPERIENCES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setOpenId(e.id)}
            className="group flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left transition-colors outline-none hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-subtle text-brand">
              <e.Icon className="size-5" />
            </span>
            <span className="min-w-0 grow space-y-0.5">
              <span className="block font-medium group-hover:underline">{e.name}</span>
              <span className="block max-w-3xl text-sm text-muted-foreground">{e.summary}</span>
            </span>
            <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              {e.MinutesIcon ? <e.MinutesIcon className="size-3.5" /> : <Timer className="size-3.5" />}
              {e.minutes}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpenId(null)}>
          {/* The title bar stays put and the experience scrolls under it, so the close button is always in reach. */}
          <DialogContent
            aria-describedby={undefined}
            className="h-dvh max-h-dvh max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0"
          >
            {/* Tall enough that the dialog's close button sits centred beside the title. */}
            <div className="flex min-h-16 items-center border-b px-6 pr-16">
              <DialogTitle>{open.name}</DialogTitle>
            </div>
            <div className="overflow-y-auto px-6 py-6">
              <div className={cn("mx-auto", !open.wide && "max-w-7xl")}>{open.render(author)}</div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
