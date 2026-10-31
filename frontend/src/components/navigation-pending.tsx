"use client";

/**
 * The gear loader from the moment a link to another page is clicked until
 * that page arrives. Keep this rather than a `loading.tsx` under `(app)`: that
 * sends a 200 before a page's gate runs, so a page someone may not see answers
 * 200 and shows its 404 or redirect in the browser, which `test/e2e` fails on.
 *
 * Only a change of path counts. A search, a sort or a pager link rewrites the
 * query string of the page already up, and hiding the page for that would
 * lose the table the person is looking at.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { GearLoader } from "@/components/gear-loader";

const StartNavigation = createContext<(href: string) => void>(() => {});

/** Call before a `router.push` to another page, so the loader shows for it as it does for a link. */
export function useStartNavigation() {
  return useContext(StartNavigation);
}

export function NavigationPending({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The path the click left from; the new page has arrived once the path moves off it.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  if (pendingFrom !== null && pendingFrom !== pathname) setPendingFrom(null);

  const start = useCallback((href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
      setPendingFrom(window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      start(a.href);
    };
    // Capture, because Next's <Link> cancels the click before it would bubble here.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  const pending = pendingFrom !== null;

  return (
    <StartNavigation.Provider value={start}>
      <div className="grid grid-cols-[minmax(0,1fr)]" data-navigating={pending || undefined}>
        <div className="nav-pending-page [grid-area:1/1]">{children}</div>
        {pending && (
          <div className="[grid-area:1/1]">
            <GearLoader />
          </div>
        )}
      </div>
    </StartNavigation.Provider>
  );
}
