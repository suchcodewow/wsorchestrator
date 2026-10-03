"use client";

/** The tab row for eVals. */

import { TabNav } from "@/components/tab-nav";
import { EVALS_TABS } from "./tabs";

export function EvalsTabs() {
  return <TabNav tabs={EVALS_TABS} label="eVals sessions" />;
}
