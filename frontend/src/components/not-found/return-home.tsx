/** The one thing every 404 scene agrees on: the way back. */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { House } from "lucide-react";
import Link from "next/link";

/**
 * The brand button, a size up and pill-shaped, so it reads as the exit on
 * whatever backdrop a scene throws behind it. The ring is what keeps it
 * standing off a loud yellow or a saturated blue; on a calm page it is just a
 * soft halo.
 */
export function ReturnHome({ className }: { className?: string }) {
  return (
    <Button
      asChild
      variant="brand"
      size="lg"
      className={cn(
        "group pointer-events-auto h-12 rounded-full px-7 text-base shadow-lg ring-4 ring-white/40",
        className,
      )}
    >
      <Link href="/">
        <House className="size-5 transition-transform duration-200 group-hover:-translate-y-0.5" />
        Return Home
      </Link>
    </Button>
  );
}
