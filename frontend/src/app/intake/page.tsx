/** The intake form a new bootcamp attendee fills in, opened from a shared link with no sign-in. */

import type { Metadata } from "next";
import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { getIntakeForm } from "@/lib/logistics/intake";
import { IntakeFormFiller } from "./intake-form";

export const metadata: Metadata = {
  title: "Bootcamp intake",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SHELL = "max-w-2xl";

export default async function IntakePage() {
  const { title, description, questions } = await getIntakeForm();
  const session = await auth();

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        <IntakeFormFiller form={{ title, description, questions }} />
      </main>
    </div>
  );
}
