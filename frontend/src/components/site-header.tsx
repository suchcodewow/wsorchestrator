import { signOut } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { SignInLink } from "@/components/sign-in-link";
import { UserMenu } from "@/components/user-menu";
import { buildInfo } from "@/lib/build-info";
import { getUserPreferences } from "@/lib/user-preferences";
import { cn } from "@/lib/utils";
import type { Session } from "next-auth";
import Link from "next/link";

/**
 * The one header, on every page.
 *
 * The landing page and the app used to carry their own near-identical bars,
 * which drifted: different brand targets, and a sign-out button that existed on
 * one and not the other. Everything that varies with the session now lives
 * inside the user menu, so the bar itself is the same shape whoever is looking
 * at it.
 *
 * `session` is passed in rather than read here — every caller has already
 * awaited it, and asking again would be a second lookup per render.
 */
export async function SiteHeader({
  session,
  width = "max-w-6xl",
}: {
  session: Session | null;
  /**
   * The bar's inner width, to match the `main` underneath it. Every page in the
   * app is `max-w-6xl` and takes the default; the attendee page is wider, and
   * a bar that stayed at 6xl there would sit its brand and menu visibly inboard
   * of the table's own edges.
   */
  width?: string;
}) {
  const { themePreference, calendarScope } = await getUserPreferences();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className={cn("mx-auto flex h-14 items-center justify-between px-6", width)}>
        <Link
          href="/"
          className="group flex items-center gap-2.5 rounded-md text-sm font-medium tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <BrandMark className="transition-transform duration-200 group-hover:scale-105" />
          Harness Events
        </Link>

        {/*
          The only nav item, and it is here rather than in the user menu because
          it is the one destination that means something to a visitor with no
          account — the room reads the guides signed out.
        */}
        <nav className="ml-auto mr-4 flex items-center">
          <Link
            href="/labs"
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Workshops
          </Link>
        </nav>

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
              // Out to the public landing page, not back to the sign-in form:
              // someone who just signed out is leaving, and being dropped on a
              // "Continue with Google" button reads as the sign-out having
              // failed.
              await signOut({ redirectTo: "/" });
            }}
          />
        ) : (
          <SignInLink />
        )}
      </div>
    </header>
  );
}
