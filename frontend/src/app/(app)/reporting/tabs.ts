/** The tabs across the top of Reporting. */

import { CalendarRange, History, Radio, type LucideIcon } from "lucide-react";
import { canSeeCanaryWire, canUseEvals, type Access } from "@/lib/roles";

export type ReportingTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  visible: (access: Access) => boolean;
};

export const REPORTING_TABS: ReportingTab[] = [
  { href: "/reporting/canary-wire", label: "Canary Wire", Icon: Radio, visible: canSeeCanaryWire },
  { href: "/reporting/canary-wire-history", label: "Canary Wire History", Icon: CalendarRange, visible: canSeeCanaryWire },
  { href: "/reporting/bootcamp-history", label: "Bootcamp History", Icon: History, visible: canUseEvals },
];

export function visibleReportingTabs(access: Access): ReportingTab[] {
  return REPORTING_TABS.filter((tab) => tab.visible(access));
}
