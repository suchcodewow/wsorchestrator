"use client";

/** The tab row for Reporting. */

import { TabNav } from "@/components/tab-nav";
import type { Access } from "@/lib/roles";
import { visibleReportingTabs } from "./tabs";

export function ReportingTabs({ access }: { access: Access }) {
  return <TabNav tabs={visibleReportingTabs(access)} label="Reporting" />;
}
