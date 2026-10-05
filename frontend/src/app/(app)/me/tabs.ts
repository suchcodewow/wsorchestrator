/** The tabs across the top of My settings. */

import {
  FileCode2,
  KeyRound,
  KeySquare,
  MonitorCheck,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { canUseEvents, type Access } from "@/lib/roles";

export type SettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Left out, every signed-in account sees it. */
  visible?: (access: Access) => boolean;
};

/**
 * The Harness tokens, org secrets and templates are what this account's events
 * deploy with, so only someone in the event area sees them. Check PC is first
 * among the rest because it is where a guest judge — who has no role anywhere —
 * lands from the sidebar.
 */
export const MY_SETTINGS_TABS: SettingsTab[] = [
  { href: "/me/tokens", label: "My Harness tokens", Icon: KeyRound, visible: canUseEvents },
  { href: "/me/org-secrets", label: "My org secrets", Icon: KeySquare, visible: canUseEvents },
  { href: "/me/templates", label: "My templates", Icon: FileCode2, visible: canUseEvents },
  { href: "/me/check-pc", label: "Check PC", Icon: MonitorCheck },
  { href: "/me/api-tokens", label: "My API tokens", Icon: Terminal },
];

export function visibleMySettingsTabs(access: Access): SettingsTab[] {
  return MY_SETTINGS_TABS.filter((tab) => tab.visible?.(access) ?? true);
}

/** The tab at `href`, gated the same way its link is. */
export function canSeeMySettingsTab(access: Access, href: string): boolean {
  return visibleMySettingsTabs(access).some((tab) => tab.href === href);
}
