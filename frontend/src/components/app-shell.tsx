/** The chrome around every page, signed in or not. */

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

export async function AppShell({
  session,
  scroll = "pane",
  children,
}: {
  session: Session | null;
  scroll?: "pane" | "document";
  children: React.ReactNode;
}) {
  const user = session?.user;

  if (!user) {
    return (
      <div className="relative min-h-screen">
        <AmbientBackdrop className="fixed inset-0 -z-10" />

        <SiteHeader session={session} />

        <main className="relative mx-auto max-w-6xl px-6 py-10">{children}</main>
      </div>
    );
  }

  const { themePreference, calendarScope } = await getUserPreferences();
  const collapsed =
    parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value) === "collapsed";

  const pane = scroll === "pane";

  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col",
        pane && "lg:h-screen lg:min-h-0 lg:overflow-hidden",
      )}
    >
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width="max-w-none" sidebar />

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
            await signOut({ redirectTo: "/" });
          }}
        />

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
