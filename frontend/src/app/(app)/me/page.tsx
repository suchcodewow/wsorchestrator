/** Sends /me to its first tab. */

import { redirect } from "next/navigation";
import { MY_SETTINGS_TABS } from "./tabs";

export default function MySettingsPage() {
  redirect(MY_SETTINGS_TABS[0]!.href);
}
