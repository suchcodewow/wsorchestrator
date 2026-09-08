/** The layout for My settings, this account's own configuration. */

import { MySettingsTabs } from "./settings-tabs";

export default function MySettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">My settings</h1>
        <p className="text-muted-foreground">
          These settings apply only to your own account.
        </p>
      </div>

      <MySettingsTabs />

      {children}
    </div>
  );
}
