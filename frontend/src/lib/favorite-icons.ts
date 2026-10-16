/** The icon a favorite shows in the sidebar: its sidebar entry's, or the tab's own. */

import type { LucideIcon } from "lucide-react";
import { ADMIN_SETTINGS_TABS } from "@/app/(app)/admin-settings/tabs";
import { COHORT_SETTINGS_TABS } from "@/app/(app)/cohort-settings/tabs";
import { COHORTS_TABS } from "@/app/(app)/cohorts/tabs";
import { EVALS_SETTINGS_TABS } from "@/app/(app)/evals-settings/tabs";
import { EVALS_TABS } from "@/app/(app)/evals/tabs";
import { IRIS_TABS } from "@/app/(app)/iris/tabs";
import { LOGISTICS_SETTINGS_TABS } from "@/app/(app)/logistics-settings/tabs";
import { LOGISTICS_TABS } from "@/app/(app)/logistics/tabs";
import { MY_SETTINGS_TABS } from "@/app/(app)/me/tabs";
import { MIMIR_SETTINGS_TABS } from "@/app/(app)/mimir-settings/tabs";
import { MIMIR_TABS } from "@/app/(app)/mimir/tabs";
import { REPORTING_TABS } from "@/app/(app)/reporting/tabs";
import { SCHEDULER_SETTINGS_TABS } from "@/app/(app)/scheduler-settings/tabs";
import { SITE_SETTINGS_TABS } from "@/app/(app)/settings/tabs";
import { navItemAt } from "@/lib/nav";

const TAB_ICONS = new Map<string, LucideIcon>(
  [
    ...ADMIN_SETTINGS_TABS,
    ...COHORT_SETTINGS_TABS,
    ...COHORTS_TABS,
    ...EVALS_SETTINGS_TABS,
    ...EVALS_TABS,
    ...IRIS_TABS,
    ...LOGISTICS_SETTINGS_TABS,
    ...LOGISTICS_TABS,
    ...MY_SETTINGS_TABS,
    ...MIMIR_SETTINGS_TABS,
    ...MIMIR_TABS,
    ...REPORTING_TABS,
    ...SCHEDULER_SETTINGS_TABS,
    ...SITE_SETTINGS_TABS,
  ].map((t) => [t.href, t.Icon]),
);

/** The icon for the favorite at `href`, or null when nothing is known of it. */
export function favoriteIcon(href: string): LucideIcon | null {
  return navItemAt(href)?.Icon ?? TAB_ICONS.get(href) ?? null;
}
