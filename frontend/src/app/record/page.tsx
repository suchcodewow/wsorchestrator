/**
 * The Harness Training Recorder: anyone in the org, signed in with Google but
 * needing no role, records their camera, and their screen if they want.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { RecordStudio } from "./record-studio";

export const metadata: Metadata = {
  title: "Harness Training Recorder",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SHELL = "max-w-3xl";

export default async function RecordPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        <RecordStudio userId={session.user.id} accountName={session.user.name ?? ""} />
      </main>
    </div>
  );
}
