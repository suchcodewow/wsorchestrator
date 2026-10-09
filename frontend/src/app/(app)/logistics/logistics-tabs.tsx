"use client";

/** The tab row for Logistics. */

import { TabNav } from "@/components/tab-nav";
import { LOGISTICS_TABS } from "./tabs";

export function LogisticsTabs() {
  return <TabNav tabs={LOGISTICS_TABS} label="Logistics" />;
}
