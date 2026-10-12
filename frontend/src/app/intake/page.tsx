/**
 * The intake form for whoever is signed in: Bootcamp Registration for a
 * bootcamp candidate in the current cohort, Intermediate Registration for an
 * intermediate one, with the answers they last saved. Anyone else is told it
 * is not for them. `?preview=bootcamp` or `?preview=intermediate` shows a
 * Training Administrator that form as the cohort sees it, without saving.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { getIntakeForm, getMyIntake, type MyIntake } from "@/lib/logistics/intake";
import { INTAKE_FORM_HEADINGS, isIntakeFormId } from "@/lib/logistics/intake-values";
import { canManageTrainingSettings } from "@/lib/roles";
import { IntakeFormFiller } from "./intake-form";

export const metadata: Metadata = {
  title: "Registration",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SHELL = "max-w-2xl";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { preview, form } = await searchParams;
  let mine: MyIntake | null;
  let previewing = false;
  if (isIntakeFormId(preview) && canManageTrainingSettings(session.user.access)) {
    const { questions } = await getIntakeForm(preview);
    mine = { form: preview, heading: INTAKE_FORM_HEADINGS[preview], questions, answers: {}, savedAt: null, name: null };
    previewing = true;
  } else {
    mine = session.user.email ? await getMyIntake(session.user.email, isIntakeFormId(form) ? form : null) : null;
  }

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        {mine?.testForms && (
          <nav aria-label="Test group forms" className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Test group:</span>
            {mine.testForms.map((f) => (
              <Link
                key={f}
                href={`/intake?form=${f}`}
                aria-current={f === mine.form ? "page" : undefined}
                className={f === mine.form ? "font-medium underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}
              >
                {INTAKE_FORM_HEADINGS[f]}
              </Link>
            ))}
          </nav>
        )}
        {!mine ? (
          <Notice heading="Registration">
            There is no registration form for {session.user.email ?? "this account"}: it is for people in the current
            bootcamp or intermediate cohort. If you think you should be in it, ask the training team.
          </Notice>
        ) : mine.questions.length === 0 ? (
          <Notice heading={mine.heading}>There is nothing to fill in yet. Check back later.</Notice>
        ) : (
          <IntakeFormFiller key={mine.form} intake={mine} preview={previewing} />
        )}
      </main>
    </div>
  );
}

function Notice({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border bg-card px-5 py-8 text-center shadow-sm">
      <h1 className="text-xl font-medium tracking-tight">{heading}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
