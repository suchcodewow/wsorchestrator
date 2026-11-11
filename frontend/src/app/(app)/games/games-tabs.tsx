"use client";

/** The tab row for Games. */

import { TabNav } from "@/components/tab-nav";
import { GAMES_TABS } from "./tabs";

export function GamesTabs() {
  return <TabNav tabs={GAMES_TABS} label="Games" />;
}
