/** The tabs across the top of Cohort Settings. */

import { Contact, Hash, Network, Settings2, Users, Workflow, type LucideIcon } from "lucide-react";
import type { Access } from "@/lib/roles";

export type CohortSettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Beyond the training administrator the whole section already requires. */
  visible?: (access: Access) => boolean;
};

export const COHORT_SETTINGS_TABS: CohortSettingsTab[] = [
  { href: "/cohort-settings/hibob", label: "HiBob", Icon: Network },
  { href: "/cohort-settings/employees", label: "Employees", Icon: Users },
  { href: "/cohort-settings/automation", label: "Automation", Icon: Settings2 },
  { href: "/cohort-settings/organization", label: "Organization", Icon: Workflow },
  { href: "/cohort-settings/channel-contacts", label: "Additional Channel Contacts", Icon: Contact },
  { href: "/cohort-settings/slack", label: "Slack", Icon: Hash },
];

export function visibleCohortSettingsTabs(access: Access): CohortSettingsTab[] {
  return COHORT_SETTINGS_TABS.filter((tab) => tab.visible?.(access) ?? true);
}
