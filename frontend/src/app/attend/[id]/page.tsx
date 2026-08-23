import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { getAttendeeView } from "@/lib/attendees";
import { AttendeeGrid } from "./attendee-grid";

/**
 * Attendee pages are per-event and shared by link; there is nothing here for a
 * search engine to index, and plenty a stray crawl could expose.
 */
export const metadata: Metadata = {
  title: "Claim your account",
  robots: { index: false, follow: false },
};

/** How wide this page runs — the header and the main read it from here. */
const SHELL = "max-w-7xl";

/**
 * The room's page. Public on purpose: attendees have no account on this app —
 * the account they are here to collect *is* their credential. Access control
 * is the unguessable event id in the URL, which the organizer shares with the
 * room and nobody else.
 */
export default async function AttendPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await getAttendeeView(id);
  if (!view) notFound();

  // Read only to render the right header. Signed out is the normal case here.
  const session = await auth();

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      {/*
        Wider than the `max-w-6xl` every other page uses. This is the one screen
        that is a table rather than a form — five columns of it, read across by
        a room of people at once — and the width all goes to the three answer
        columns, which are what actually run out of room. The header takes the
        same cap so the brand and the menu stay flush with the table's edges.
      */}
      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        <AttendeeGrid initial={view} runId={id} />
      </main>
    </div>
  );
}
