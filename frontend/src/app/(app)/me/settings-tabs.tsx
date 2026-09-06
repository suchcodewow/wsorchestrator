"use client";

import { TabNav } from "@/components/tab-nav";
import { MY_SETTINGS_TABS } from "./tabs";

/**
 * The tab row for My settings.
 *
 * Thin, and it has to exist: `TabNav` is a client component and each tab carries
 * a Lucide icon *component*. A server layout rendering `<TabNav tabs={...}>`
 * would be handing functions across the boundary, which React refuses — "Functions
 * cannot be passed directly to Client Components" — so the tab list has to be
 * imported by something already on the client. That is this file, and it is why
 * the layout renders `<MySettingsTabs />` with no props at all.
 */
export function MySettingsTabs() {
  return <TabNav tabs={MY_SETTINGS_TABS} label="My settings" />;
}
