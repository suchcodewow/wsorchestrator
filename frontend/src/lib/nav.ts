/** The navigation sections, and which of them a user's access may see. */

import {
  BrainCircuit,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Cloud,
  DatabaseBackup,
  Eye,
  FlaskConical,
  House,
  Inbox,
  Layers,
  LibraryBig,
  Luggage,
  ScrollText,
  Settings,
  Settings2,
  SlidersHorizontal,
  TestTubes,
  UserCog,
  Users,
  UsersRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  canAuditProjects,
  canManageBackups,
  canManageEvalsSettings,
  canManageMimir,
  canManageSettings,
  canManageSignInDomains,
  canManageTrainingSettings,
  canManageUsers,
  canScoreAssessments,
  canSeeReporting,
  canTakeIris,
  canUseEvents,
  canUseMimir,
  canUseTraining,
  canViewAuditTrail,
  type Access,
} from "@/lib/roles";

export type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** One line on what it is for, on its card on the Welcome page. */
  description: string;
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

/** The Welcome page: first in the sidebar, for everyone. */
export const WELCOME_HREF = "/welcome";

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Home",
    items: [{ href: WELCOME_HREF, label: "Welcome", Icon: House, description: "Everything you can reach, in one place." }],
  },
  {
    heading: "Events",
    items: [
      {
        href: "/labs",
        label: "Event Guides",
        Icon: Layers,
        description: "The lab guides attendees follow at a workshop.",
        visible: canUseEvents,
      },
      {
        href: "/events",
        label: "Orchestrator",
        Icon: CalendarDays,
        description: "Schedule a workshop and build its accounts, Harness org and cloud.",
        also: ["/runs"],
        visible: canUseEvents,
      },
      {
        href: "/cloud-status",
        label: "Cloud Status",
        Icon: Cloud,
        description: "What each cloud holds now, and anything left behind.",
        visible: canAuditProjects,
      },
      {
        href: "/settings",
        label: "Event Settings",
        Icon: SlidersHorizontal,
        description: "Org secrets, templates and repositories for every event.",
        visible: canManageSettings,
      },
    ],
  },
  {
    heading: "Training",
    items: [
      {
        href: "/scheduler",
        label: "Scheduler",
        Icon: CalendarClock,
        description: "Bootcamp schedules, sessions, judges and day checklists.",
        visible: canUseTraining,
      },
      {
        href: "/scheduler-settings",
        label: "Scheduler settings",
        Icon: CalendarCog,
        description: "Facilities, rooms and session types.",
        visible: canManageTrainingSettings,
      },
      {
        href: "/cohorts",
        label: "Cohorts",
        Icon: Users,
        description: "Who is in each bootcamp cohort.",
        visible: canUseTraining,
      },
      {
        href: "/cohort-settings",
        label: "Cohort Settings",
        Icon: Settings2,
        description: "Employees, HiBob, the organization and Slack channels.",
        visible: canManageTrainingSettings,
      },
      { href: "/logistics", label: "Logistics", Icon: Luggage, description: "Guest judges, dietary needs and food orders.", visible: canUseTraining },
      {
        href: "/logistics-settings",
        label: "Logistics settings",
        Icon: ClipboardList,
        description: "The intake form new attendees fill in, and its responses.",
        visible: canManageTrainingSettings,
      },
      {
        href: "/mimir",
        label: "Mimir",
        Icon: BrainCircuit,
        description: "Harness's agents and capabilities, with an AI coach.",
        visible: canUseMimir,
      },
      {
        href: "/mimir-settings",
        label: "Mimir Settings",
        Icon: LibraryBig,
        description: "The library's content and the coach's settings.",
        visible: canManageMimir,
      },
    ],
  },
  {
    heading: "Enablement Tools",
    items: [
      {
        href: "/recordings",
        label: "Async Recordings",
        Icon: Video,
        description: "One link anyone in the org can use to record their camera, and their screen, as separate files.",
        visible: canManageTrainingSettings,
      },
    ],
  },
  {
    heading: "Assessments",
    items: [
      {
        href: "/evals",
        label: "eVals",
        Icon: FlaskConical,
        description: "Score attendees on bootcamp and intermediate assessments.",
        visible: canScoreAssessments,
      },
      { href: "/iris", label: "Iris", Icon: Eye, description: "Adaptive placement tests.", visible: canTakeIris },
      {
        href: "/reporting",
        label: "Reporting",
        Icon: ChartColumn,
        description: "Bootcamp history and the Canary Wire.",
        visible: canSeeReporting,
      },
      {
        href: "/evals-settings",
        label: "eVals settings",
        Icon: TestTubes,
        description: "Google Meetings, assessments and Slack contacts.",
        visible: canManageEvalsSettings,
      },
    ],
  },
  {
    heading: "Account",
    items: [
      { href: "/inbox", label: "My inbox", Icon: Inbox, description: "Checklist items you own, and everywhere you're tagged." },
      { href: "/me", label: "My settings", Icon: UserCog, description: "Your theme, API tokens, and a check of your PC." },
    ],
  },
  {
    heading: "Administration",
    items: [
      {
        href: "/users",
        label: "Manage users",
        Icon: UsersRound,
        description: "Everyone's roles, and invitations.",
        visible: canManageUsers,
      },
      {
        href: "/backups",
        label: "Backups",
        Icon: DatabaseBackup,
        description: "Back up and restore the database.",
        visible: canManageBackups,
      },
      {
        href: "/admin-settings",
        label: "Admin Settings",
        Icon: Settings,
        description: "Who may sign in.",
        visible: canManageSignInDomains,
      },
      {
        href: "/audit",
        label: "Audit Trail",
        Icon: ScrollText,
        description: "Every change anyone has made.",
        visible: canViewAuditTrail,
      },
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
