/** The tabs across the top of Admin Settings. */

import { Clock, Globe, Plug, type LucideIcon } from "lucide-react";

export type AdminSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const ADMIN_SETTINGS_TABS: AdminSettingsTab[] = [
  { href: "/admin-settings/domains", label: "Sign-in Domains", Icon: Globe },
  { href: "/admin-settings/connectors", label: "External Connectors", Icon: Plug },
  { href: "/admin-settings/timed-jobs", label: "Timed Jobs", Icon: Clock },
];
