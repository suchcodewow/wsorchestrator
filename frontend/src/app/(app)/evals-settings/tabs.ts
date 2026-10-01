/** The tabs across the top of eVals settings. */

import {
  ClipboardList,
  Network,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Access } from "@/lib/roles";

export type EvalsSettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Beyond the eVals administrator the whole section already requires. */
  visible?: (access: Access) => boolean;
};

export const EVALS_SETTINGS_TABS: EvalsSettingsTab[] = [
  { href: "/evals-settings/hibob", label: "HiBob", Icon: Network },
  { href: "/evals-settings/employees", label: "Employees", Icon: Users },
  { href: "/evals-settings/automation", label: "Automation", Icon: Settings2 },
  { href: "/evals-settings/attendee-tracking", label: "Attendee Tracking", Icon: ClipboardList },
];

export function visibleEvalsSettingsTabs(access: Access): EvalsSettingsTab[] {
  return EVALS_SETTINGS_TABS.filter((tab) => tab.visible?.(access) ?? true);
}
