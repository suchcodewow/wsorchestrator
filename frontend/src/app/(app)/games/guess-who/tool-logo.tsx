/**
 * A tool card's logo: the bundled one on a white tile, since several marks are
 * black and would vanish on a dark card; or, for a card with none, its
 * initials on a color picked by name, so the color carries no hint.
 */

import Image from "next/image";
import { initials, logoSrc, type GuessWhoTool } from "@/lib/games/guess-who";
import { cn } from "@/lib/utils";

const PLACEHOLDER_COLORS = [
  "bg-slate-600",
  "bg-teal-600",
  "bg-amber-600",
  "bg-violet-600",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-rose-600",
  "bg-orange-600",
  "bg-indigo-600",
  "bg-lime-700",
];

function placeholderColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLACEHOLDER_COLORS[h % PLACEHOLDER_COLORS.length]!;
}

/** Sized by `className` (a width, or a size); square either way. */
export function ToolLogo({ tool, className }: { tool: GuessWhoTool; className?: string }) {
  const src = logoSrc(tool.id);
  if (src) {
    return (
      // The PNGs carry their own padding, so the tile adds only a sliver.
      <span className={cn("block aspect-square overflow-hidden rounded-lg bg-white p-[2%] shadow-xs ring-1 ring-black/5", className)}>
        {/* The whole board is on screen at once, so every logo loads straight away. */}
        <Image src={src} alt="" width={256} height={256} loading="eager" className="size-full object-contain" draggable={false} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex aspect-square items-center justify-center rounded-lg font-bold text-white shadow-inner",
        placeholderColor(tool.name),
        className,
      )}
      aria-hidden
    >
      {initials(tool.name)}
    </span>
  );
}
