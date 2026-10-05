"use client";

/** The tab row for Cohorts, with how many are on Current. */

import { TabNav } from "@/components/tab-nav";
import { COHORTS_TABS } from "./tabs";

export function CohortsTabs({ currentCount }: { currentCount: number }) {
  const tabs = COHORTS_TABS.map((t) => (t.href === "/cohorts/current" ? { ...t, count: currentCount } : t));
  return <TabNav tabs={tabs} label="Cohorts" />;
}
