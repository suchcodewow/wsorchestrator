/** The tabs across the top of Diagnostic Settings. */

import { ClipboardList, FileQuestion, Hash, MessageSquare, UsersRound } from "lucide-react";
import type { TabItem } from "@/components/tab-nav";

export const DIAGNOSTIC_SETTINGS_TABS: TabItem[] = [
  { href: "/diagnostic-settings/participants", label: "Participants", Icon: UsersRound },
  { href: "/diagnostic-settings/records", label: "Records", Icon: ClipboardList },
  { href: "/diagnostic-settings/questions", label: "Questions", Icon: FileQuestion },
  { href: "/diagnostic-settings/feedback", label: "Feedback", Icon: MessageSquare },
  { href: "/diagnostic-settings/slack", label: "Slack", Icon: Hash },
];
