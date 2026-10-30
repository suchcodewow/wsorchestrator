/** The tabs across the top of Reporting. */

import { GraduationCap, Radio, type LucideIcon } from "lucide-react";
import { canSeeBootcampRecords, canSeeCanaryWire, type Access } from "@/lib/roles";

export type ReportingTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  visible: (access: Access) => boolean;
};

export const REPORTING_TABS: ReportingTab[] = [
  { href: "/reporting/canary-wire", label: "Canary Wire", Icon: Radio, visible: canSeeCanaryWire },
  { href: "/reporting/bootcamp", label: "Live Sessions", Icon: GraduationCap, visible: canSeeBootcampRecords },
];

export function visibleReportingTabs(access: Access): ReportingTab[] {
  return REPORTING_TABS.filter((tab) => tab.visible(access));
}
