"use client";

/**
 * A tooltip around a button, which still shows while the button is disabled:
 * a disabled button gets no pointer events, so the tooltip hangs off a span
 * around it.
 */

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function Hint({ content, disabled, children }: { content: ReactNode; disabled: boolean; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" tabIndex={disabled ? 0 : -1}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="space-y-1">{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
