"use client";

/** The tab row for site settings. */

import { TabNav } from "@/components/tab-nav";
import type { Access } from "@/lib/roles";
import { visibleSettingsTabs } from "./tabs";

export function SiteSettingsTabs({ access }: { access: Access }) {
  return <TabNav tabs={visibleSettingsTabs(access)} label="Site settings" />;
}
