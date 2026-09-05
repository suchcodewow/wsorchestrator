import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { buildInfo } from "@/lib/build-info";
import { SIDEBAR_COOKIE, parseSidebarState } from "@/lib/sidebar";
import { getUserPreferences } from "@/lib/user-preferences";

/**
 * The signed-in app's shell.
 *
 * Two layouts, one tree. From `lg` up the whole thing is pinned to the viewport
 * and only the content pane scrolls, so the sidebar stays put while a long page
 * of runs or a table of users moves past it. Below `lg` the sidebar is not
 * rendered at all and this falls back to an ordinary document that scrolls as a
 * whole, with the sticky header and the menu under the username doing what they
 * always did.
 *
 * The viewport pinning is deliberately `lg`-only. Locking the body height on a
 * phone fights the browser's own collapsing chrome and breaks pull-to-refresh
 * for nothing — there is no fixed sidebar down there to hold still.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  // Already cached per request, so the header asking for the same thing is one
  // query rather than two.
  const { themePreference, calendarScope } = await getUserPreferences();
  const collapsed =
    parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value) === "collapsed";

  return (
    <div className="relative flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
      {/* Ambient colour under the whole app; never scrolls, never interactive. */}
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width="max-w-none" sidebar />

      {/* `min-h-0` is what lets the pane below actually scroll: without it a
          flex child refuses to shrink past its content and the overflow moves
          back out to the locked wrapper, which has nowhere to put it. */}
      <div className="flex min-h-0 flex-1">
        <AppSidebar
          name={session.user.name ?? null}
          email={session.user.email ?? ""}
          role={session.user.siteRole}
          initialTheme={themePreference}
          initialScope={calendarScope}
          build={buildInfo()}
          defaultCollapsed={collapsed}
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
        <main className="relative min-w-0 flex-1 lg:overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
