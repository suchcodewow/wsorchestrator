"use client";

/** The tab row for Cohorts, with how many are on Current and Deferred. */

import { TabNav } from "@/components/tab-nav";
import { COHORTS_TABS } from "./tabs";

export function CohortsTabs({ currentCount, deferredCount }: { currentCount: number; deferredCount: number }) {
  const counts: Record<string, number> = { "/cohorts/current": currentCount, "/cohorts/deferred": deferredCount };
  const tabs = COHORTS_TABS.map((t) => (t.href in counts ? { ...t, count: counts[t.href] } : t));
  return <TabNav tabs={tabs} label="Cohorts" />;
}
