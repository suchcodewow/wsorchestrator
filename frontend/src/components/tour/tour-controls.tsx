"use client";

/** The header's question mark, which plays the page's tour again; there only when the page has one. */

import { CircleHelp } from "lucide-react";
import { usePageTour } from "@/components/tour/tour-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function TourControls() {
  const page = usePageTour();
  if (!page?.tour || page.tour.steps.length === 0) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Show this page's tour" disabled={page.playing} onClick={page.play}>
            <CircleHelp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Show this page&apos;s tour</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
