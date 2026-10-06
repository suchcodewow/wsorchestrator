"use client";

/** A labelled on/off switch, in the bordered pill a toolbar's other controls sit in. */

import { cn } from "@/lib/utils";

export function PillSwitch({ label, title, on, onChange }: { label: string; title?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5 shadow-xs">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        title={title}
        onClick={() => onChange(!on)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
          on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <span aria-hidden className={cn("flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors", on ? "bg-brand" : "bg-input")}>
          <span className={cn("size-3 rounded-full bg-background shadow-xs transition-transform duration-200 ease-out", on && "translate-x-3")} />
        </span>
      </button>
    </div>
  );
}
