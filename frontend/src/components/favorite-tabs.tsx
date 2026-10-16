"use client";

/** The signed-in user's starred tabs, shared by the tab rows and the sidebar. */

import { createContext, useCallback, useContext, useState } from "react";
import type { FavoriteTab } from "@/db/schema";
import { MAX_FAVORITE_TABS } from "@/lib/favorite-tabs";
import { setFavoriteTabs } from "@/lib/user-settings";

type Favorites = {
  tabs: readonly FavoriteTab[];
  has: (href: string) => boolean;
  toggle: (tab: FavoriteTab) => void;
};

const FavoritesContext = createContext<Favorites | null>(null);

export function FavoriteTabsProvider({
  initial,
  children,
}: {
  initial: FavoriteTab[];
  children: React.ReactNode;
}) {
  const [tabs, setTabs] = useState<FavoriteTab[]>(initial);

  const toggle = useCallback(
    (tab: FavoriteTab) => {
      const next = tabs.some((t) => t.href === tab.href)
        ? tabs.filter((t) => t.href !== tab.href)
        : [...tabs, tab].slice(-MAX_FAVORITE_TABS);
      setTabs(next);
      void setFavoriteTabs(next).catch(() => setTabs(tabs));
    },
    [tabs],
  );

  const has = useCallback((href: string) => tabs.some((t) => t.href === href), [tabs]);

  return (
    <FavoritesContext.Provider value={{ tabs, has, toggle }}>
      {children}
    </FavoritesContext.Provider>
  );
}

/** Null outside the signed-in shell, where there is nothing to star. */
export function useFavoriteTabs(): Favorites | null {
  return useContext(FavoritesContext);
}
