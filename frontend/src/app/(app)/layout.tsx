import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { UserMenu } from "@/components/user-menu";
import { getThemePreference } from "@/lib/theme-preference";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const theme = await getThemePreference();

  return (
    <div className="relative min-h-screen">
      {/* Page texture, fading out below the fold so content sits on plain ground. */}
      <div className="pointer-events-none fixed inset-0 bg-grid mask-fade" />

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            href="/events"
            className="group flex items-center gap-2.5 rounded-md text-sm font-medium tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <BrandMark className="transition-transform duration-200 group-hover:scale-105" />
            Event Orchestrator
          </Link>

          <div className="flex items-center gap-1.5">
            <UserMenu
              name={session.user.name ?? null}
              email={session.user.email ?? ""}
              initialTheme={theme}
            />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
