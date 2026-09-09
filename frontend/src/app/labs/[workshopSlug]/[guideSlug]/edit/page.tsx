/** The guide editor, opened from the workshop the guide is read in. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { getLabGuideBySlug, workshopsUsingGuide } from "@/lib/lab-guides";
import { getWorkshopGuide } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";
import { GuideEditor } from "../../../guide-editor";

export const metadata: Metadata = {
  title: "Edit lab guide",
  robots: { index: false, follow: false },
};

export default async function EditWorkshopGuidePage({
  params,
}: {
  params: Promise<{ workshopSlug: string; guideSlug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageLabGuides(session.user.siteRole)) notFound();

  const { workshopSlug, guideSlug } = await params;

  const found = await getWorkshopGuide(workshopSlug, guideSlug, true);
  if (!found) notFound();

  const guide = await getLabGuideBySlug(guideSlug);
  if (!guide) notFound();

  const usedIn = await workshopsUsingGuide(guide.id);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/labs/${found.workshop.slug}/${guide.slug}`}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        Back to the lab
      </Link>

      <h1 className="mt-6 mb-8 text-2xl font-medium tracking-tight">
        Edit lab guide
      </h1>

      <GuideEditor
        guide={guide}
        usedIn={usedIn}
        within={{ slug: found.workshop.slug, title: found.workshop.title }}
      />
    </div>
  );
}
