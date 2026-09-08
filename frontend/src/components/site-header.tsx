/** The one header, on every page. */

import { signOut } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { SignInLink } from "@/components/sign-in-link";
import { UserMenu } from "@/components/user-menu";
import { buildInfo } from "@/lib/build-info";
import { getUserPreferences } from "@/lib/user-preferences";
import { cn } from "@/lib/utils";
import type { Session } from "next-auth";
import Link from "next/link";

export async function SiteHeader({
  session,
  width = "max-w-6xl",
  sidebar = false,
}: {
  session: Session | null;
  width?: string;
  sidebar?: boolean;
}) {
  const { themePreference, calendarScope } = await getUserPreferences();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className={cn("mx-auto flex h-14 items-center gap-4 px-6", width)}>
        <Link
          href="/"
          aria-label="Harness Events"
          className="group flex shrink-0 items-center gap-2.5 rounded-md text-sm font-medium tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <BrandMark className="transition-transform duration-200 group-hover:scale-105" />
          <span className="hidden sm:inline">Harness Events</span>
        </Link>

        <div className="ml-auto flex items-center gap-4">
          {!session?.user && (
            <nav className="flex shrink-0 items-center">
              <Link
                href="/labs"
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Workshops
              </Link>
            </nav>
          )}

          <div className={cn("min-w-0", sidebar && "lg:hidden")}>
            {session?.user ? (
              <UserMenu
                name={session.user.name ?? null}
                email={session.user.email ?? ""}
                role={session.user.siteRole}
                initialTheme={themePreference}
                initialScope={calendarScope}
                build={buildInfo()}
                signOutAction={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              />
            ) : (
              <SignInLink />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
