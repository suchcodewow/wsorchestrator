import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { signOut } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { buildInfo } from "@/lib/build-info";
import { SIDEBAR_COOKIE, parseSidebarState } from "@/lib/sidebar";
import { getUserPreferences } from "@/lib/user-preferences";
import { cn } from "@/lib/utils";

/**
 * The chrome around every page, signed in or not.
 *
 * There are two shapes here, chosen by the session rather than by the route.
 * Signed in you get the sidebar — on `/labs` too, which is why this is a shared
 * component and not the `(app)` layout's private business. A sidebar that
 * vanished on the workshops pages read as the app having lost its navigation,
 * when in fact those routes only live outside `(app)` because they must also
 * serve visitors with no account. Signed out there is no navigation to show, so
 * the page is a header over a single column, exactly as before.
 *
 * `session` is passed in rather than read here: the caller has already awaited
 * it to decide about redirects, and the header needs it too.
 */
export async function AppShell({
  session,
  scroll = "pane",
  children,
}: {
  session: Session | null;
  /**
   * Which box scrolls, from `lg` up.
   *
   * `pane` pins the whole shell to the viewport and lets only the content pane
   * scroll, so the sidebar stays put while a long page of runs moves past it.
   *
   * `document` keeps the ordinary document scroll and makes the sidebar sticky
   * instead — the same stillness, reached the other way. The lab guides need it:
   * their contents rail tracks the reading position off `window` scroll and the
   * document's own height, and neither says anything useful once the scrolling
   * has moved into a `div`.
   */
  scroll?: "pane" | "document";
  children: React.ReactNode;
}) {
  const user = session?.user;

  // No account, so nothing to hang a sidebar off. The bar keeps its default
  // width, which lines it up with the single column underneath it.
  if (!user) {
    return (
      <div className="relative min-h-screen">
        <AmbientBackdrop className="fixed inset-0 -z-10" />

        <SiteHeader session={session} />

        <main className="relative mx-auto max-w-6xl px-6 py-10">{children}</main>
      </div>
    );
  }

  // Already cached per request, so the header asking for the same thing is one
  // query rather than two.
  const { themePreference, calendarScope } = await getUserPreferences();
  const collapsed =
    parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value) === "collapsed";

  const pane = scroll === "pane";

  return (
    // The viewport pinning is deliberately `lg`-only. Locking the body height on
    // a phone fights the browser's own collapsing chrome and breaks
    // pull-to-refresh for nothing — below `lg` the sidebar is not rendered at
    // all, so there is nothing down there to hold still.
    <div
      className={cn(
        "relative flex min-h-screen flex-col",
        pane && "lg:h-screen lg:min-h-0 lg:overflow-hidden",
      )}
    >
      {/* Ambient colour under the whole app; never scrolls, never interactive. */}
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width="max-w-none" sidebar />

      {/* `min-h-0` is what lets the pane below actually scroll: without it a
          flex child refuses to shrink past its content and the overflow moves
          back out to the locked wrapper, which has nowhere to put it. */}
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          name={user.name ?? null}
          email={user.email ?? ""}
          role={user.siteRole}
          initialTheme={themePreference}
          initialScope={calendarScope}
          build={buildInfo()}
          defaultCollapsed={collapsed}
          sticky={!pane}
          signOutAction={async () => {
            "use server";
            // Out to the public landing page, not back to the sign-in form:
            // someone who just signed out is leaving, and being dropped on a
            // "Continue with Google" button reads as the sign-out having failed.
            await signOut({ redirectTo: "/" });
          }}
        />

        {/* `min-w-0` so a wide table inside scrolls itself instead of forcing
            the pane wider and pushing the sidebar off the screen. */}
        <main
          className={cn(
            "relative min-w-0 flex-1",
            pane && "lg:overflow-y-auto",
          )}
        >
          <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
