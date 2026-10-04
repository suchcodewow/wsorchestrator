"use client";

/** The tab row for Scheduler settings. */

import { TabNav } from "@/components/tab-nav";
import { SCHEDULER_SETTINGS_TABS } from "./tabs";

export function SchedulerSettingsTabs() {
  return <TabNav tabs={SCHEDULER_SETTINGS_TABS} label="Scheduler settings" />;
}
