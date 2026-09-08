"use client";

/** Keeps the theme cookie current so the server can paint the right scheme. */

import { useEffect } from "react";
import type { ThemePreference } from "@/db/schema";
import { DARK_QUERY, applyTheme } from "@/lib/theme";

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
