/** The tabs across the top of My settings. */

import {
  FileCode2,
  KeyRound,
  KeySquare,
  Terminal,
  type LucideIcon,
} from "lucide-react";

export type SettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export const MY_SETTINGS_TABS: SettingsTab[] = [
  { href: "/me/tokens", label: "My Harness tokens", Icon: KeyRound },
  { href: "/me/org-secrets", label: "My org secrets", Icon: KeySquare },
  { href: "/me/templates", label: "My templates", Icon: FileCode2 },
  { href: "/me/api-tokens", label: "My API tokens", Icon: Terminal },
];
