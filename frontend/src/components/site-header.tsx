/** The one header, on every page. */

import { signInPath, signOut } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { buildInfo, deploymentEnvironment } from "@/lib/build-info";
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
  const { themePreference } = await getUserPreferences();
  const environment = deploymentEnvironment();

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

        {environment && (
          <span
            title={`This is the ${environment} deployment, not production`}
            className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"
          >
            {environment}
          </span>
        )}

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
                image={session.user.image ?? null}
                access={session.user.access}
                initialTheme={themePreference}
                build={buildInfo()}
                signOutAction={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              />
            ) : (
              // Signing in returns the reader to the page they were on.
              <Button asChild variant="ghost" size="sm">
                <Link href={await signInPath()}>Sign in</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
