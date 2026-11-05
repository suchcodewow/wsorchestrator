/** The tabs across the top of Reporting Settings. */

import { MessageSquareShare, Radio, type LucideIcon } from "lucide-react";

export type ReportingSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const REPORTING_SETTINGS_TABS: ReportingSettingsTab[] = [
  { href: "/reporting-settings/feedback", label: "Feedback Management", Icon: MessageSquareShare },
  { href: "/reporting-settings/canary-wire", label: "Canary Wire", Icon: Radio },
];
