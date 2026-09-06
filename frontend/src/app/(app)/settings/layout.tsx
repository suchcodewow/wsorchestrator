import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canManageSettings } from "@/lib/roles";
import { SiteSettingsTabs } from "./settings-tabs";

/**
 * Site settings — the deployment's own configuration, as opposed to `/me`, which
 * is one account's.
 *
 * The role check is here rather than repeated in each tab: a layout runs for
 * every page under it, so one check covers the section and a tab added later
 * cannot forget it. The API routes check again on every write, which is where it
 * actually matters — this only decides whether the page is drawn.
 *
 * The heading and the tab row live in the layout so they survive a tab
 * navigation: the tabs stay put and only the panel below them changes.
 */
export default async function SiteSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Not a redirect and not a 403: for anyone below administrator this section
  // simply isn't there, and saying "forbidden" would only advertise it.
  if (!canManageSettings(session.user.siteRole)) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Site-wide configuration. Only administrators see this page.
        </p>
      </div>

      <SiteSettingsTabs />

      {children}
    </div>
  );
}
