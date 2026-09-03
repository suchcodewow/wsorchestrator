import { SettingsTabs } from "./settings-tabs";

/**
 * My settings — this account's own configuration, as opposed to `/settings`,
 * which is the site's and belongs to administrators.
 *
 * Open to every signed-in account: the enclosing `(app)` layout is what requires
 * a session, and nothing under here needs a role. Somebody's own tokens and
 * preferences are theirs whatever they are allowed to do with the rest of the
 * app.
 *
 * The heading and the tab row live in the layout so they survive a tab
 * navigation — the tabs stay put and only the panel below them changes.
 */
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
          Yours alone. Nothing here changes anything for anyone else.
        </p>
      </div>

      <SettingsTabs />

      {children}
    </div>
  );
}
