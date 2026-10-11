"use client";

/**
 * A textarea that is never shorter than `rows` lines and grows to fit what is
 * in it: sized as soon as it mounts, so text already there shows whole, and
 * again as it is typed in or its width changes. CSS `field-sizing: content`
 * would do this, but Firefox and older Safari ignore it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function AutoGrowTextarea({ className, rows = 2, ...props }: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Back to `rows` first, so it shrinks when text is taken out.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);

  useLayoutEffect(fit, [fit, props.value]);

  // A narrower field wraps onto more lines. Only a change of width refits, so
  // the height this sets does not set it off again.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  return <Textarea ref={ref} rows={rows} className={cn("min-h-0 resize-none overflow-hidden", className)} {...props} />;
}
