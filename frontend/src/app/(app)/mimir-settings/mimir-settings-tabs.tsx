"use client";

/** The tab row for Mimir Settings. */

import { TabNav } from "@/components/tab-nav";
import { MIMIR_SETTINGS_TABS } from "./tabs";

export function MimirSettingsTabs() {
  return <TabNav tabs={MIMIR_SETTINGS_TABS} label="Mimir Settings" />;
}
