/** The tabs across the top of Mimir Settings. */

import { BarChart3, FileText, Map as MapIcon, MessageSquareText, PencilRuler, Smile } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const MIMIR_SETTINGS_TABS: TabItem[] = [
  { href: "/coach-canary-settings/reporting", label: "Reporting", Icon: BarChart3 },
  { href: "/coach-canary-settings/map", label: "Map", Icon: MapIcon },
  { href: "/coach-canary-settings/map-editor", label: "Map Editor", Icon: PencilRuler },
  { href: "/coach-canary-settings/content", label: "Archived content", Icon: FileText },
  { href: "/coach-canary-settings/coaching", label: "Coaching", Icon: MessageSquareText },
  { href: "/coach-canary-settings/feedback", label: "Coach Canary Feedback", Icon: Smile },
];
