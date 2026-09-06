"use client";

import { TabNav } from "@/components/tab-nav";
import { SITE_SETTINGS_TABS } from "./tabs";

/**
 * The tab row for site settings. See `me/settings-tabs.tsx` — same reason it is
 * a client component of its own: the tab list holds icon components, and those
 * cannot be passed as props from the server layout.
 */
export function SiteSettingsTabs() {
  return <TabNav tabs={SITE_SETTINGS_TABS} label="Site settings" />;
}
