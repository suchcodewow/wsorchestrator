/** The tabs across the top of site settings. */

import {
  AtSign,
  FileCode2,
  Github,
  KeySquare,
  type LucideIcon,
} from "lucide-react";

export type SiteSettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export const SITE_SETTINGS_TABS: SiteSettingsTab[] = [
  { href: "/settings/domains", label: "Sign-in domains", Icon: AtSign },
  { href: "/settings/org-secrets", label: "Org Secrets", Icon: KeySquare },
  { href: "/settings/templates", label: "Templates", Icon: FileCode2 },
  { href: "/settings/repos", label: "GitHub Repos", Icon: Github },
];
