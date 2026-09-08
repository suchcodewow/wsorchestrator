"use client";

/** The tab row for My settings. */

import { TabNav } from "@/components/tab-nav";
import { MY_SETTINGS_TABS } from "./tabs";

export function MySettingsTabs() {
  return <TabNav tabs={MY_SETTINGS_TABS} label="My settings" />;
}
