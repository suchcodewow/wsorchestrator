"use client";

/**
 * The Sparkles icon button that has Claude write comments, on an assessment's
 * recordings, in the participation popup and on a class's overall feedback. Its tooltip says what it does,
 * or why it cannot yet; a disabled button gets no pointer events, so the
 * tooltip hangs off a span around it.
 */

import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AiCommentsButton({
  pending,
  disabled = false,
  reason,
  label: usual = "Generate AI comments",
  onClick,
}: {
  pending: boolean;
  disabled?: boolean;
  /** Shown in place of the usual tooltip while it is disabled. */
  reason?: string;
  /** Its tooltip and accessible name, when it writes something other than comments. */
  label?: string;
  onClick: () => void;
}) {
  const label = (disabled && reason) || usual;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" tabIndex={disabled ? 0 : -1}>
            <Button variant="ghost" size="icon" className="size-8" aria-label={label} disabled={disabled || pending} onClick={onClick}>
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
