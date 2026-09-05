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

/**
 * The app's destinations, in one list.
 *
 * Two things render this: the desktop sidebar and — below `lg`, where there is
 * no sidebar — the dropdown under the username. They used to be one menu, so
 * there was nothing to keep in step; now that there are two, the list lives
 * here rather than in either of them. A page added to only one of the two is
 * the exact failure this file exists to prevent.
 *
 * Icons matter more than they look like they should: collapsed, the sidebar is
 * *only* icons, so no two items may share a glyph. That is why the orchestrator
 * takes a calendar rather than the gear it had in the dropdown — a gear there
 * sat two rows from "My settings" and one from "Admin settings", which is
 * survivable with labels beside it and unreadable without them.
 */

export type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /**
   * Extra path prefixes that should light this item up. A run belongs to the
   * orchestrator even though `/runs/[id]` shares no prefix with `/events`, and
   * a sidebar with nothing lit reads as "you are nowhere".
   */
  also?: string[];
  /** Who may see it. Omitted means every signed-in account. */
  visible?: (role: SiteRole) => boolean;
};

export type NavSection = {
  /** Omitted on the first group on purpose — see below. */
  heading?: string;
  items: NavItem[];
  /**
   * A group that is one control rather than a list of destinations. Each
   * consumer draws the control itself — a switch in the sidebar, a menu row in
   * the dropdown — but its position among the groups is settled here, which is
   * the point: the calendar scope belongs directly under the orchestrator it
   * changes, not stranded below the administration links.
   */
  control?: "calendar-scope";
  /** Who may use a `control` group. Items carry their own gate. */
  visible?: (role: SiteRole) => boolean;
};

export const NAV_SECTIONS: NavSection[] = [
  /*
   * Everything every account can do comes first and unheaded: an operator sees
   * a plain list, and the headed group below reads as an addition to it rather
   * than as one category among two.
   */
  {
    items: [
      // First, and the one destination outside this group: following it leaves
      // the app shell, so the sidebar goes away and /labs' own table of
      // contents takes over. It stays in the header for visitors with no
      // account, who have neither a sidebar nor a menu to find it in.
      { href: "/labs", label: "Workshops", Icon: Layers },
      { href: "/events", label: "Orchestrator", Icon: CalendarDays, also: ["/runs"] },
      // Ungated alongside the orchestrator: contributing components is the floor
      // permission, not a privilege. What a contribution can reach is decided at
      // review, so there is nothing to gate here.
      { href: "/contribute", label: "Contribute", Icon: Blocks },
      // This account's own configuration — the Harness tokens it has saved —
      // which is not a privilege and not the site's. "Admin settings" below is
      // the site's, and the labels are what keep the two apart.
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
        // "Admin" in the label because the appearance and calendar controls are
        // settings too, and the two are not the same thing: one is this
        // account's, this one is the whole site's.
        href: "/settings",
        label: "Admin settings",
        Icon: SlidersHorizontal,
        visible: canManageSettings,
      },
    ],
  },
];

/**
 * The sections `role` may actually see, with empty ones dropped so a heading
 * never stands over nothing.
 *
 * Gating per item and then discarding the empties — rather than a separate
 * "does this role unlock anything in here" flag per group — means the heading
 * cannot disagree with its contents. The server still re-checks every page;
 * nothing here is enforcement.
 */
export function visibleSections(role: SiteRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.visible?.(role) ?? true),
  })).filter(
    (section) =>
      section.items.length > 0 || (section.control ? (section.visible?.(role) ?? true) : false),
  );
}

/** Whether `pathname` is inside `item` — exact, or a segment below it. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
