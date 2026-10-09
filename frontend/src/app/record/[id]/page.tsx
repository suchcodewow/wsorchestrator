/** The Harness Training Recorder, opened from a shared link with no sign-in: record a camera, and a screen if wanted. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { isActiveLink } from "@/lib/recording/recordings";
import { RecordStudio } from "./record-studio";

export const metadata: Metadata = {
  title: "Harness Training Recorder",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SHELL = "max-w-3xl";

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isActiveLink(id))) notFound();

  const session = await auth();

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        <RecordStudio linkId={id} />
      </main>
    </div>
  );
}
