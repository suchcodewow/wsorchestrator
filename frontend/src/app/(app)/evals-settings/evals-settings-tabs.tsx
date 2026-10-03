"use client";

/** The tab row for eVals settings. */

import { TabNav } from "@/components/tab-nav";
import { EVALS_SETTINGS_TABS } from "./tabs";

export function EvalsSettingsTabs() {
  return <TabNav tabs={EVALS_SETTINGS_TABS} label="eVals settings" />;
}
