import { cn } from "@/lib/utils";

/**
 * The product mark: three stacked bars in brand mint, reading as scheduled
 * blocks on a timeline. Drawn inline rather than as an icon-font glyph so the
 * middle bar can carry the accent on its own.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-brand/10 ring-1 ring-brand/20",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="size-4" fill="none">
        <rect x="2" y="3" width="8" height="2.5" rx="1.25" fill="currentColor" className="text-brand/45" />
        <rect x="2" y="6.75" width="12" height="2.5" rx="1.25" fill="currentColor" className="text-brand" />
        <rect x="2" y="10.5" width="6" height="2.5" rx="1.25" fill="currentColor" className="text-brand/45" />
      </svg>
    </span>
  );
}
