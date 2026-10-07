/** The tabs across the top of eVals settings. */

import { ClipboardCheck, Contact, Video, type LucideIcon } from "lucide-react";

export type EvalsSettingsTab = { href: string; label: string; Icon: LucideIcon };

export const EVALS_SETTINGS_TABS: EvalsSettingsTab[] = [
  { href: "/evals-settings/google-meetings", label: "Google Meetings", Icon: Video },
  { href: "/evals-settings/assessments", label: "Assessments", Icon: ClipboardCheck },
  { href: "/evals-settings/slack-contacts", label: "Additional Slack Contacts", Icon: Contact },
];
