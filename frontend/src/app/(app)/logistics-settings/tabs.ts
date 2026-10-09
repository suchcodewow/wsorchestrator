/** The tabs across the top of Logistics settings. */

import { ClipboardList, Inbox, type LucideIcon } from "lucide-react";

export type LogisticsSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const LOGISTICS_SETTINGS_TABS: LogisticsSettingsTab[] = [
  { href: "/logistics-settings/intake", label: "Intake", Icon: ClipboardList },
  { href: "/logistics-settings/responses", label: "Responses", Icon: Inbox },
];
