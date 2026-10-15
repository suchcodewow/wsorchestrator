/** Admin Settings opens on its first tab. */

import { redirect } from "next/navigation";

export default function AdminSettingsPage() {
  redirect("/admin-settings/domains");
}
