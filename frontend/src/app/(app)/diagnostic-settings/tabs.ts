/** The tabs across the top of Diagnostic Settings. */

import { FileQuestion, UsersRound } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const DIAGNOSTIC_SETTINGS_TABS: TabItem[] = [
  { href: "/diagnostic-settings/participants", label: "Participants", Icon: UsersRound },
  { href: "/diagnostic-settings/questions", label: "Questions", Icon: FileQuestion },
];
