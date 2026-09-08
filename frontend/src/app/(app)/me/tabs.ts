/** The tabs across the top of My settings. */

import { KeyRound, type LucideIcon } from "lucide-react";

export type SettingsTab = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export const MY_SETTINGS_TABS: SettingsTab[] = [
  { href: "/me/tokens", label: "My tokens", Icon: KeyRound },
];
