"use client";

/** The tab row for Diagnostic Settings. */

import { TabNav } from "@/components/tab-nav";
import { DIAGNOSTIC_SETTINGS_TABS } from "./tabs";

export function DiagnosticSettingsTabs() {
  return <TabNav tabs={DIAGNOSTIC_SETTINGS_TABS} label="Diagnostic Settings" />;
}
