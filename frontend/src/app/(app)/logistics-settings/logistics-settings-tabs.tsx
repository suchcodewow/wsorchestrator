"use client";

/** The tab row for Logistics settings. */

import { TabNav } from "@/components/tab-nav";
import { LOGISTICS_SETTINGS_TABS } from "./tabs";

export function LogisticsSettingsTabs() {
  return <TabNav tabs={LOGISTICS_SETTINGS_TABS} label="Logistics settings" />;
}
