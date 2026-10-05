/** The tabs across the top of Reporting. */

import { History, Radio, type LucideIcon } from "lucide-react";

export type ReportingTab = { href: string; label: string; Icon: LucideIcon };

export const REPORTING_TABS: ReportingTab[] = [
  { href: "/reporting/canary-wire", label: "Canary Wire", Icon: Radio },
  { href: "/reporting/bootcamp-history", label: "Bootcamp History", Icon: History },
];
