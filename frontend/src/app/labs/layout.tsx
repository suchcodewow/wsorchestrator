import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";

/**
 * Chrome for the whole `/labs` subtree.
 *
 * The same shape as the `(app)` layout, minus the redirect — and that
 * difference is the reason the guides live outside `(app)` rather than in it.
 * A lab guide is read by a room full of people who have no account on this
 * site; sending them to a "Continue with Google" button would defeat the point
 * of publishing one.
 *
 * The editor pages sit under here too, and gate themselves. They cannot live
 * in `(app)` instead: two route groups cannot each claim `/labs/[…]`, and one
 * of them naming the segment `[slug]` while the other names it `[id]` is a
 * build error rather than a preference.
 */
export default async function LabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} />

      <main className="relative mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
