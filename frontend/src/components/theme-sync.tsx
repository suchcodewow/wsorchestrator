"use client";

import { useEffect } from "react";
import type { ThemePreference } from "@/db/schema";
import { DARK_QUERY, applyTheme } from "@/lib/theme";

/**
 * Keeps the theme cookie current from the client, where `system` can actually
 * be resolved, so the *server* can paint the right scheme on the next load
 * without any client `matchMedia` read at first paint.
 *
 * On mount it re-applies the resolved theme — refreshing the cookie for next
 * time and correcting a first visit or a scheme that changed since the cookie
 * was last written. While on `system` it also follows live OS changes, which a
 * plain refresh would otherwise never pick up.
 *
 * Renders nothing; it lives in the root layout so it runs on every page,
 * signed in or out.
 */
export function ThemeSync({ preference }: { preference: ThemePreference }) {
  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  return null;
}
