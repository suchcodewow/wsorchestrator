/** The tabs a user stars, and what may be saved as one. */

import type { FavoriteTab } from "@/db/schema";

/** How many tabs a user may star; the list is saved whole. */
export const MAX_FAVORITE_TABS = 25;

/** The favorites in `value`, or null if it is not a list of in-app links with labels. */
export function parseFavoriteTabs(value: unknown): FavoriteTab[] | null {
  if (!Array.isArray(value) || value.length > MAX_FAVORITE_TABS) return null;
  const seen = new Set<string>();
  const tabs: FavoriteTab[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") return null;
    const { href, label } = v as { href?: unknown; label?: unknown };
    if (typeof href !== "string" || typeof label !== "string") return null;
    if (!/^\/(?!\/)[^\s\\]*$/.test(href) || href.length > 200) return null;
    const text = label.trim();
    if (!text || text.length > 80) return null;
    if (seen.has(href)) continue;
    seen.add(href);
    tabs.push({ href, label: text });
  }
  return tabs;
}
