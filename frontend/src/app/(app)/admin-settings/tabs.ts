/** The tabs across the top of Admin Settings. */

import { Globe, Plug, type LucideIcon } from "lucide-react";

export type AdminSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const ADMIN_SETTINGS_TABS: AdminSettingsTab[] = [
  { href: "/admin-settings/domains", label: "Sign-in Domains", Icon: Globe },
  { href: "/admin-settings/connectors", label: "External Connectors", Icon: Plug },
];
