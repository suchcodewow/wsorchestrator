"use client";

/** The signed-in account as its Google photo, or a single glyph without one. */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function Avatar({
  name,
  email,
  image,
  className,
}: {
  name: string | null;
  email: string;
  image?: string | null;
  className?: string;
}) {
  // A Google photo URL can stop resolving (the photo was changed or removed
  // since sign-in), so a broken one falls back to the initial. The server
  // renders the <img>, so it can fail before React attaches `onError`; the ref
  // catches that case once hydrated.
  const [failed, setFailed] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (image && img?.complete && img.naturalWidth === 0) setFailed(image);
  }, [image]);
  const initial = (name ?? email).trim().charAt(0).toUpperCase() || "?";
  const box = cn("flex size-8 shrink-0 rounded-full", className);

  if (image && failed !== image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={image}
        alt=""
        aria-hidden
        // Google's photo host refuses some requests that carry a Referer.
        referrerPolicy="no-referrer"
        onError={() => setFailed(image)}
        className={cn(box, "bg-muted object-cover")}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        box,
        "items-center justify-center bg-brand/10 text-xs font-medium text-brand",
      )}
    >
      {initial}
    </span>
  );
}
