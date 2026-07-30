import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="relative min-h-screen">
      {/* Ambient colour under the whole app; never scrolls, never interactive. */}
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} />

      <main className="relative mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
