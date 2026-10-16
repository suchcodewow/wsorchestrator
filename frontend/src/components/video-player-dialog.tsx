"use client";

/**
 * The window every video in the app plays in: a dialog that fills the browser
 * window, with its title along the top and the video scaled to fit the rest.
 * It stands in for the browser's own full screen, which `VideoWithFeedback`
 * turns off, so the feedback buttons over the video are always there.
 */

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** For a `VideoWithFeedback` in the dialog: fills the space under the title, letterboxed. */
export const FILL_VIDEO = { wrapperClassName: "h-full", className: "size-full rounded-lg bg-black object-contain" } as const;

export function VideoPlayerDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** The player, or what stands in for it while it loads. */
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-dvh max-h-dvh max-w-none grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-none p-4"
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="space-y-1 pr-8">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </div>
        <div className="relative min-h-0">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
