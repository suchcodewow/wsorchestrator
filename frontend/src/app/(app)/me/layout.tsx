/** The layout for My settings, this account's own configuration. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { MySettingsTabs } from "./settings-tabs";

export default async function MySettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">My settings</h1>

      <MySettingsTabs access={session.user.access} />

      {children}
    </div>
  );
}
