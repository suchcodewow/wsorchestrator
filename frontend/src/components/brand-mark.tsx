/** The product mark: a slowly turning gear. */

import { cn } from "@/lib/utils";

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-brand/10 text-brand ring-1 ring-brand/20",
        className,
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4.5 motion-safe:animate-gear-turn"
        fill="none"
      >
        {TEETH.map((angle) => (
          <rect
            key={angle}
            x="10.78"
            y="1.1"
            width="2.44"
            height="5.6"
            rx="0.8"
            fill="currentColor"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
        <circle cx="12" cy="12" r="6.95" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="12" cy="12" r="1.85" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  );
}
