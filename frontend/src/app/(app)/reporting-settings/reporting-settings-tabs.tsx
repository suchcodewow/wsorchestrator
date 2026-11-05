"use client";

/** The tab row for Reporting Settings. */

import { TabNav } from "@/components/tab-nav";
import { REPORTING_SETTINGS_TABS } from "./tabs";

export function ReportingSettingsTabs() {
  return <TabNav tabs={REPORTING_SETTINGS_TABS} label="Reporting Settings" />;
}
