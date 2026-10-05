"use client";

/** The tab row for Reporting. */

import { TabNav } from "@/components/tab-nav";
import { REPORTING_TABS } from "./tabs";

export function ReportingTabs() {
  return <TabNav tabs={REPORTING_TABS} label="Reporting" />;
}
