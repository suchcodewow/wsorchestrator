/** The still colour wash behind the app. */

import { cn } from "@/lib/utils";

export function AmbientBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("app-backdrop pointer-events-none", className)}
    />
  );
}
