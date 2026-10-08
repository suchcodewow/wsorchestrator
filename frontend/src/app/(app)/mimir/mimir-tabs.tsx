"use client";

/** The tab row for Mimir. */

import { TabNav } from "@/components/tab-nav";
import { MIMIR_TABS } from "./tabs";

export function MimirTabs() {
  return <TabNav tabs={MIMIR_TABS} label="Mimir" />;
}
