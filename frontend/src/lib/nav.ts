/** The navigation sections, and which of them a role may see. */

import {
  Blocks,
  CalendarDays,
  Cloud,
  DatabaseBackup,
  Layers,
  SlidersHorizontal,
  Terminal,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { SiteRole } from "@/db/schema";
import {
  canAuditProjects,
  canManageBackups,
  canManageSettings,
  canManageUsers,
  canRunSql,
  canSeeAllEvents,
} from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  also?: string[];
  visible?: (role: SiteRole) => boolean;
};

export type NavSection = {
  heading?: string;
  items: NavItem[];
  control?: "calendar-scope";
  visible?: (role: SiteRole) => boolean;
};

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/labs", label: "Event Guides", Icon: Layers },
      { href: "/events", label: "Orchestrator", Icon: CalendarDays, also: ["/runs"] },
      { href: "/contribute", label: "Contribute", Icon: Blocks },
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
        label: "Admin settings",
        Icon: SlidersHorizontal,
        visible: canManageSettings,
      },
    ],
  },
];

export function visibleSections(role: SiteRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.visible?.(role) ?? true),
  })).filter(
    (section) =>
      section.items.length > 0 || (section.control ? (section.visible?.(role) ?? true) : false),
  );
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
