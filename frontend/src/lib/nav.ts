/** The navigation sections, and which of them a user's access may see. */

import {
  CalendarClock,
  CalendarCog,
  CalendarDays,
  Cloud,
  DatabaseBackup,
  FlaskConical,
  Layers,
  Settings,
  SlidersHorizontal,
  TestTubes,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  canAuditProjects,
  canManageBackups,
  canManageEvalsSettings,
  canManageSchedulerSettings,
  canManageSettings,
  canManageSignInDomains,
  canManageUsers,
  canSeeAllEvents,
  canUseEvals,
  canUseEvents,
  canUseScheduler,
  type Access,
} from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  also?: string[];
  visible?: (access: Access) => boolean;
};

/** A switch that sits among a section's links rather than leading anywhere. */
export type NavControl = {
  control: "calendar-scope";
  label: string;
  visible?: (access: Access) => boolean;
};

export type NavEntry = NavItem | NavControl;

/**
 * One area of the app, or the account and platform pages around them. Within
 * an area the entries run from what everyone in it uses, through what its
 * managers use, to its administration.
 */
export type NavSection = {
  heading: string;
  items: NavEntry[];
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
      { control: "calendar-scope", label: "Show all events", visible: canSeeAllEvents },
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
    heading: "Scheduler",
    items: [
      { href: "/scheduler", label: "Scheduler", Icon: CalendarClock, visible: canUseScheduler },
      {
        href: "/scheduler-settings",
        label: "Scheduler settings",
        Icon: CalendarCog,
        visible: canManageSchedulerSettings,
      },
    ],
  },
  {
    heading: "eVals",
    items: [
      { href: "/evals", label: "eVals", Icon: FlaskConical, visible: canUseEvals },
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
    ],
  },
];

export function isNavLink(entry: NavEntry): entry is NavItem {
  return "href" in entry;
}

/** The links in `section`, leaving out its controls. */
export function navLinks(section: NavSection): NavItem[] {
  return section.items.filter(isNavLink);
}

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
