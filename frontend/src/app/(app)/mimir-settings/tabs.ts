/** The tabs across the top of Mimir Settings. */

import { FileText, Map as MapIcon, MessageSquareText } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const MIMIR_SETTINGS_TABS: TabItem[] = [
  { href: "/mimir-settings/map", label: "Map", Icon: MapIcon },
  { href: "/mimir-settings/content", label: "Archived content", Icon: FileText },
  { href: "/mimir-settings/coaching", label: "Coaching", Icon: MessageSquareText },
];
