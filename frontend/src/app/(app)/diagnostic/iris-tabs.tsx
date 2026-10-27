"use client";

/** The tab row for Diagnostic, shown to Assessments Administrators only. */

import { TabNav } from "@/components/tab-nav";
import { IRIS_TABS } from "./tabs";

export function IrisTabs() {
  return <TabNav tabs={IRIS_TABS} label="Diagnostic" />;
}
