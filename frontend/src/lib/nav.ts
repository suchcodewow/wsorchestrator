/** The navigation sections, and which of them a user's access may see. */

import {
  CalendarClock,
  CalendarCog,
  CalendarDays,
  Cloud,
  DatabaseBackup,
  FlaskConical,
  History,
  Layers,
  ScrollText,
  Settings,
  Settings2,
  SlidersHorizontal,
  TestTubes,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  canAuditProjects,
  canManageBackups,
  canManageEvalsSettings,
  canManageSettings,
  canManageSignInDomains,
  canManageTrainingSettings,
  canManageUsers,
  canUseEvals,
  canUseEvents,
  canUseTraining,
  canViewAuditTrail,
  type Access,
} from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  also?: string[];
  visible?: (access: Access) => boolean;
};

/**
 * One area of the app, or the account and platform pages around them. Within
 * an area the entries run from what everyone in it uses, through what its
 * managers use, to its administration.
 */
export type NavSection = {
  heading: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Events",
    items: [
      { href: "/labs", label: "Event Guides", Icon: Layers, visible: canUseEvents },
      {
        href: "/events",
        label: "Orchestrator",
        Icon: CalendarDays,
        also: ["/runs"],
        visible: canUseEvents,
      },
      { href: "/cloud-status", label: "Cloud Status", Icon: Cloud, visible: canAuditProjects },
      {
        href: "/settings",
        label: "Event Settings",
        Icon: SlidersHorizontal,
        visible: canManageSettings,
      },
    ],
  },
  {
    heading: "Training",
    items: [
      { href: "/scheduler", label: "Scheduler", Icon: CalendarClock, visible: canUseTraining },
      {
        href: "/scheduler-settings",
        label: "Scheduler settings",
        Icon: CalendarCog,
        visible: canManageTrainingSettings,
      },
      { href: "/cohorts", label: "Cohorts", Icon: Users, visible: canUseTraining },
      {
        href: "/cohort-settings",
        label: "Cohort Settings",
        Icon: Settings2,
        visible: canManageTrainingSettings,
      },
    ],
  },
  {
    heading: "eVals",
    items: [
      { href: "/evals", label: "eVals", Icon: FlaskConical, visible: canUseEvals },
      { href: "/bootcamp-history", label: "Bootcamp History", Icon: History, visible: canUseEvals },
      {
        href: "/evals-settings",
        label: "eVals settings",
        Icon: TestTubes,
        visible: canManageEvalsSettings,
      },
    ],
  },
  {
    heading: "Account",
    items: [{ href: "/me", label: "My settings", Icon: UserCog }],
  },
  {
    heading: "Administration",
    items: [
      { href: "/users", label: "Manage users", Icon: UsersRound, visible: canManageUsers },
      { href: "/backups", label: "Backups", Icon: DatabaseBackup, visible: canManageBackups },
      {
        href: "/admin-settings",
        label: "Admin Settings",
        Icon: Settings,
        visible: canManageSignInDomains,
      },
      { href: "/audit", label: "Audit Trail", Icon: ScrollText, visible: canViewAuditTrail },
    ],
  },
];

/** The sections `access` may see, each holding only the entries it may see. */
export function visibleSections(access: Access): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((entry) => entry.visible?.(access) ?? true),
  })).filter((section) => section.items.length > 0);
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
