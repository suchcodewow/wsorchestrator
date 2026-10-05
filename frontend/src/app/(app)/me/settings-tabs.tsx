"use client";

/** The tab row for My settings. */

import { TabNav } from "@/components/tab-nav";
import type { Access } from "@/lib/roles";
import { visibleMySettingsTabs } from "./tabs";

export function MySettingsTabs({ access }: { access: Access }) {
  return <TabNav tabs={visibleMySettingsTabs(access)} label="My settings" />;
}
