/** The attendee page, opened from a shared link with no sign-in. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { getAttendeeView } from "@/lib/attendees";
import { AttendeeGrid } from "./attendee-grid";

export const metadata: Metadata = {
  title: "Claim your account",
  robots: { index: false, follow: false },
};

const SHELL = "max-w-7xl";

export default async function AttendPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await getAttendeeView(id);
  if (!view) notFound();

  const session = await auth();

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        <AttendeeGrid initial={view} runId={id} />
      </main>
    </div>
  );
}
