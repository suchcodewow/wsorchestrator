/** The tabs across the top of Cohorts. */

import { Clock, History, UserCheck, type LucideIcon } from "lucide-react";
import { canUseTraining, type Access } from "@/lib/roles";

export type CohortsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Beyond `canSeeCurrentCohort`, which the whole section requires. */
  visible?: (access: Access) => boolean;
};

export const COHORTS_TABS: CohortsTab[] = [
  { href: "/cohorts/current", label: "Current", Icon: UserCheck },
  { href: "/cohorts/deferred", label: "Deferred", Icon: Clock, visible: canUseTraining },
  { href: "/cohorts/previous", label: "Previous", Icon: History, visible: canUseTraining },
];

/** A guest judge with no training role sees Current alone. */
export function visibleCohortsTabs(access: Access): CohortsTab[] {
  return COHORTS_TABS.filter((tab) => tab.visible?.(access) ?? true);
}
