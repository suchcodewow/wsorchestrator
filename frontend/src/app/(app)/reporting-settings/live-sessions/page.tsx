/** Reporting Settings → Live Sessions Settings: which optional sections a person's Live Sessions page shows. */

import type { Metadata } from "next";
import { getLiveSessionsSettings } from "@/lib/reporting/live-sessions-settings";
import { LiveSessionsSettingsView } from "./live-sessions-settings-view";

export const metadata: Metadata = { title: "Live Sessions settings" };

export default async function LiveSessionsSettingsPage() {
  return <LiveSessionsSettingsView initial={await getLiveSessionsSettings()} />;
}
