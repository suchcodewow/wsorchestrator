/** Sends /settings to its first tab. */

import { redirect } from "next/navigation";
import { SITE_SETTINGS_TABS } from "./tabs";

export default function SiteSettingsPage() {
  redirect(SITE_SETTINGS_TABS[0]!.href);
}
