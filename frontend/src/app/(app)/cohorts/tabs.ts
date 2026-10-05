/** The tabs across the top of Cohorts. */

import { Clock, History, UserCheck, type LucideIcon } from "lucide-react";

export type CohortsTab = { href: string; label: string; Icon: LucideIcon };

export const COHORTS_TABS: CohortsTab[] = [
  { href: "/cohorts/current", label: "Current", Icon: UserCheck },
  { href: "/cohorts/deferred", label: "Deferred", Icon: Clock },
  { href: "/cohorts/previous", label: "Previous", Icon: History },
];
