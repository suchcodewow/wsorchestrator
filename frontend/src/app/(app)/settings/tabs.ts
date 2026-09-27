/** The tabs across the top of site settings. */

import {
  AtSign,
  FileCode2,
  Github,
  KeySquare,
  type LucideIcon,
} from "lucide-react";
import { canManageSignInDomains, type Access } from "@/lib/roles";

export type SiteSettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Beyond the event administrator the whole section already requires. */
  visible?: (access: Access) => boolean;
};

export const SITE_SETTINGS_TABS: SiteSettingsTab[] = [
  {
    href: "/settings/domains",
    label: "Sign-in domains",
    Icon: AtSign,
    visible: canManageSignInDomains,
  },
  { href: "/settings/org-secrets", label: "Org Secrets", Icon: KeySquare },
  { href: "/settings/templates", label: "Templates", Icon: FileCode2 },
  { href: "/settings/repos", label: "GitHub Repos", Icon: Github },
];

export function visibleSettingsTabs(access: Access): SiteSettingsTab[] {
  return SITE_SETTINGS_TABS.filter((tab) => tab.visible?.(access) ?? true);
}
