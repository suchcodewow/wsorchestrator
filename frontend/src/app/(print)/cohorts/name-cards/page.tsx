/**
 * A tent card for everyone on Cohorts → Current, to print on letter paper and
 * fold down the middle: bootcamp first, then intermediate, by name. It sits
 * outside the app's shell so only the cards print.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { currentCohortNames } from "@/lib/evals/current-cohort";
import { canUseTraining } from "@/lib/roles";
import { PrintButton } from "@/components/print-button";
import { NameCard } from "./name-card";

export const metadata: Metadata = { title: "Name cards" };

export default async function NameCardsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseTraining(session.user.access)) notFound();

  const people = await currentCohortNames();
  const bootcamp = people.filter((p) => p.stage === "bootcamp").length;

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 scheme-light print:min-h-0 print:bg-white">
      <style>{"@page { size: letter portrait; margin: 0; }"}</style>
      <header className="mx-auto flex max-w-[8.5in] items-end justify-between gap-4 px-4 py-6 print:hidden">
        <div>
          <h1 className="text-lg font-semibold">Name cards</h1>
          <p className="text-xs text-neutral-600">
            {bootcamp} bootcamp, {people.length - bootcamp} intermediate
          </p>
        </div>
        {people.length > 0 && <PrintButton />}
      </header>
      {people.length === 0 ? (
        <p className="mx-auto max-w-[8.5in] px-4 text-sm text-neutral-600">No one is on the Current tab.</p>
      ) : (
        <div className="flex flex-col items-center gap-6 pb-10 print:block print:gap-0 print:pb-0">
          {people.map((p, i) => (
            <NameCard key={i} name={p.fullName} stage={p.stage} />
          ))}
        </div>
      )}
    </div>
  );
}
