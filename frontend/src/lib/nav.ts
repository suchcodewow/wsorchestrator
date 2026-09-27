/** The navigation sections, and which of them a user's access may see. */

import {
  Blocks,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  Cloud,
  DatabaseBackup,
  Layers,
  Settings,
  SlidersHorizontal,
  Terminal,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  canAuditProjects,
  canManageBackups,
  canManageSchedulerSettings,
  canManageSettings,
  canManageSignInDomains,
  canManageUsers,
  canRunSql,
  canSeeAllEvents,
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

export type NavSection = {
  heading?: string;
  items: NavItem[];
  control?: "calendar-scope";
  visible?: (access: Access) => boolean;
};

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/labs", label: "Event Guides", Icon: Layers, visible: canUseEvents },
      {
        href: "/events",
        label: "Orchestrator",
        Icon: CalendarDays,
        also: ["/runs"],
        visible: canUseEvents,
      },
      { href: "/contribute", label: "Contribute", Icon: Blocks, visible: canUseEvents },
      { href: "/scheduler", label: "Scheduler", Icon: CalendarClock, visible: canUseScheduler },
      { href: "/me", label: "My settings", Icon: UserCog },
    ],
  },
  {
    heading: "Management",
    items: [],
    control: "calendar-scope",
    visible: canSeeAllEvents,
  },
  {
    heading: "Administration",
    items: [
      { href: "/users", label: "Manage users", Icon: UsersRound, visible: canManageUsers },
      { href: "/backups", label: "Backups", Icon: DatabaseBackup, visible: canManageBackups },
      { href: "/database", label: "Database", Icon: Terminal, visible: canRunSql },
      { href: "/cloud-status", label: "Cloud Status", Icon: Cloud, visible: canAuditProjects },
      {
        href: "/settings",
        label: "Event Settings",
        Icon: SlidersHorizontal,
        visible: canManageSettings,
      },
      {
        href: "/scheduler-settings",
        label: "Scheduler settings",
        Icon: CalendarCog,
        visible: canManageSchedulerSettings,
      },
      {
        href: "/admin-settings",
        label: "Admin Settings",
        Icon: Settings,
        visible: canManageSignInDomains,
      },
    ],
  },
];

export function visibleSections(access: Access): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.visible?.(access) ?? true),
  })).filter(
    (section) =>
      section.items.length > 0 || (section.control ? (section.visible?.(access) ?? true) : false),
  );
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
