import { redirect } from "next/navigation";
import { MY_SETTINGS_TABS } from "./tabs";

/**
 * `/me` is the address people will type and the one the menu could reasonably
 * link to, but there is no page at the top of a tab set — so it lands on the
 * first tab. Taken from the tab list rather than hard-coded, so reordering the
 * tabs moves the default with them.
 */
export default function MySettingsPage() {
  redirect(MY_SETTINGS_TABS[0]!.href);
}
