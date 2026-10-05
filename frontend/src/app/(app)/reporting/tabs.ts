/** The tabs across the top of Reporting. */

import { History, Radio, type LucideIcon } from "lucide-react";
import { canSeeCanaryWire, type Access } from "@/lib/roles";

export type ReportingTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Beyond the eVals Viewer the whole section already requires. */
  visible?: (access: Access) => boolean;
};

export const REPORTING_TABS: ReportingTab[] = [
  { href: "/reporting/canary-wire", label: "Canary Wire", Icon: Radio, visible: canSeeCanaryWire },
  { href: "/reporting/bootcamp-history", label: "Bootcamp History", Icon: History },
];

export function visibleReportingTabs(access: Access): ReportingTab[] {
  return REPORTING_TABS.filter((tab) => tab.visible?.(access) ?? true);
}
