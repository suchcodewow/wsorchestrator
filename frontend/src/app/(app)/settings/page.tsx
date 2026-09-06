import { redirect } from "next/navigation";
import { SITE_SETTINGS_TABS } from "./tabs";

/**
 * `/settings` is the address the sidebar links to, but there is no page at the
 * top of a tab set — so it lands on the first tab. Taken from the tab list
 * rather than hard-coded, so reordering the tabs moves the default with them.
 *
 * The layout has already required an administrator, so there is nothing to check
 * here.
 */
export default function SiteSettingsPage() {
  redirect(SITE_SETTINGS_TABS[0]!.href);
}
