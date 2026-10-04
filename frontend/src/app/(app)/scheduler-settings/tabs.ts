/** The tabs across the top of Scheduler settings. */

import { Building2, Shapes, type LucideIcon } from "lucide-react";

export type SchedulerSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const SCHEDULER_SETTINGS_TABS: SchedulerSettingsTab[] = [
  { href: "/scheduler-settings/facilities", label: "Facilities", Icon: Building2 },
  { href: "/scheduler-settings/session-types", label: "Session types", Icon: Shapes },
];
