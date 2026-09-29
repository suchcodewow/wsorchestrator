"use client";

/** The tab row for eVals settings. */

import { TabNav } from "@/components/tab-nav";
import type { Access } from "@/lib/roles";
import { visibleEvalsSettingsTabs } from "./tabs";

export function EvalsSettingsTabs({ access }: { access: Access }) {
  return <TabNav tabs={visibleEvalsSettingsTabs(access)} label="eVals settings" />;
}
