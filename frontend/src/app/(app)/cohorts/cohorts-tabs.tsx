"use client";

/** The tab row for Cohorts. */

import { TabNav } from "@/components/tab-nav";
import { COHORTS_TABS } from "./tabs";

export function CohortsTabs() {
  return <TabNav tabs={COHORTS_TABS} label="Cohorts" />;
}
