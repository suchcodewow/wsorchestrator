/** The tabs across the top of Mimir Settings. */

import { FileText, MessageSquareText } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const MIMIR_SETTINGS_TABS: TabItem[] = [
  { href: "/mimir-settings/content", label: "Content", Icon: FileText },
  { href: "/mimir-settings/coaching", label: "Coaching", Icon: MessageSquareText },
];
