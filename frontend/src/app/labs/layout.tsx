import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";

/**
 * Chrome for the whole `/labs` subtree.
 *
 * The same [[AppShell]] as the `(app)` group, minus the redirect — and that
 * difference is the reason the guides live outside `(app)` rather than in it.
 * A lab guide is read by a room full of people who have no account on this
 * site; sending them to a "Continue with Google" button would defeat the point
 * of publishing one. So the shell decides on the session instead: signed in,
 * these pages keep the app's sidebar, because a workshop is somewhere you go
 * *within* the app and losing the navigation there looks like a bug.
 *
 * The editor pages sit under here too, and gate themselves. They cannot live
 * in `(app)` instead: two route groups cannot each claim `/labs/[…]`, and one
 * of them naming the segment `[slug]` while the other names it `[id]` is a
 * build error rather than a preference.
 *
 * `document` scroll rather than the app's scrolling pane: a guide's contents
 * rail follows the reading position off the window, so the window has to be
 * what moves. See [[AppShell]].
 */
export default async function LabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <AppShell session={session} scroll="document">
      {children}
    </AppShell>
  );
}
