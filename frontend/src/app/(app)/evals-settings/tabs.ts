/** The tabs across the top of eVals settings. */

import {
  Briefcase,
  ClipboardList,
  EyeOff,
  Network,
  Wrench,
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
  { href: "/evals-settings/sales-titles", label: "Automatic Sales Titles", Icon: Briefcase },
  { href: "/evals-settings/engineer-titles", label: "Automatic Engineer Titles", Icon: Wrench },
  { href: "/evals-settings/ignored-titles", label: "Ignored Titles", Icon: EyeOff },
  { href: "/evals-settings/attendee-tracking", label: "Attendee Tracking", Icon: ClipboardList },
];

export function visibleEvalsSettingsTabs(access: Access): EvalsSettingsTab[] {
  return EVALS_SETTINGS_TABS.filter((tab) => tab.visible?.(access) ?? true);
}
