/**
 * The wide-view page layout, for a page that gains from more room than the
 * app's reading column gives it: it spans 95% of the width beside the sidebar,
 * centred. Wrap a page's content in it; the rest of the page (a header or tabs
 * from a layout) keeps the usual column. The shell's `<main>` is the container
 * the percentage is taken from, so it follows the sidebar opening and closing.
 */

import { cn } from "@/lib/utils";

export function WideView({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("relative left-1/2 w-[95cqw] -translate-x-1/2", className)} {...props} />;
}
