"use client";

/** The tab row for Cohort Settings. */

import { TabNav } from "@/components/tab-nav";
import type { Access } from "@/lib/roles";
import { visibleCohortSettingsTabs } from "./tabs";

export function CohortSettingsTabs({ access }: { access: Access }) {
  return <TabNav tabs={visibleCohortSettingsTabs(access)} label="Cohort Settings" />;
}
