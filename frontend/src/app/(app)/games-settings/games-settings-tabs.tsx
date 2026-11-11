"use client";

/** The tab row for Games settings. */

import { TabNav } from "@/components/tab-nav";
import { GAMES_SETTINGS_TABS } from "./tabs";

export function GamesSettingsTabs() {
  return <TabNav tabs={GAMES_SETTINGS_TABS} label="Games settings" />;
}
