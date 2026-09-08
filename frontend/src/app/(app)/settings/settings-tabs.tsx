"use client";

/** The tab row for site settings. */

import { TabNav } from "@/components/tab-nav";
import { SITE_SETTINGS_TABS } from "./tabs";

export function SiteSettingsTabs() {
  return <TabNav tabs={SITE_SETTINGS_TABS} label="Site settings" />;
}
