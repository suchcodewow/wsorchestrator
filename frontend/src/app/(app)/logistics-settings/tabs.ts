/** The tabs across the top of Logistics settings. */

import { BellRing, ClipboardList, GraduationCap, Inbox, type LucideIcon } from "lucide-react";

export type LogisticsSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const LOGISTICS_SETTINGS_TABS: LogisticsSettingsTab[] = [
  { href: "/logistics-settings/pre-bootcamp", label: "Pre-Bootcamp", Icon: ClipboardList },
  { href: "/logistics-settings/pre-intermediate", label: "Pre-Intermediate", Icon: GraduationCap },
  { href: "/logistics-settings/responses", label: "Responses", Icon: Inbox },
  { href: "/logistics-settings/reminders", label: "Reminders", Icon: BellRing },
];
