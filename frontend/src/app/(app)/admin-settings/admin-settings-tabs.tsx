"use client";

/** The tab row for Admin Settings. */

import { TabNav } from "@/components/tab-nav";
import { ADMIN_SETTINGS_TABS } from "./tabs";

export function AdminSettingsTabs() {
  return <TabNav tabs={ADMIN_SETTINGS_TABS} label="Admin settings" />;
}
