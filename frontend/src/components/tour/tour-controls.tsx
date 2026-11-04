"use client";

/**
 * The header's tour buttons: a question mark that plays the page's tour,
 * there only when the page has one and traced round by a rainbow glow for a
 * couple of seconds the first time someone who does not administer the page
 * arrives, and for whoever administers the
 * page a pencil that opens the editor, which on a page with no tour starts one.
 */

import { CircleHelp, Pencil } from "lucide-react";
import { GlowTrace } from "@/components/tour/glow-trace";
import { usePageTour } from "@/components/tour/tour-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function TourControls() {
  const page = usePageTour();
  if (!page) return null;
  const hasTour = !!page.tour && page.tour.steps.length > 0;
  if (!hasTour && !page.canEdit) return null;

  const editLabel = hasTour ? "Edit this page's tour" : "Add a tour to this page";

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {hasTour && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative size-8"
                aria-label="Show this page's tour"
                disabled={page.playing}
                onClick={page.play}
              >
                <CircleHelp />
                {page.beckoning && <GlowTrace duration={2000} blur={4} onDone={page.stopBeckoning} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show this page&apos;s tour</TooltipContent>
          </Tooltip>
        )}
        {page.canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={editLabel} aria-pressed={page.editing} disabled={page.editing} onClick={page.edit}>
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{editLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
