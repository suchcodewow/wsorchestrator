import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { getLabGuideBySlug, workshopsUsingGuide } from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";
import { GuideEditor } from "../../../guide-editor";

export const metadata: Metadata = {
  title: "Edit lab guide",
  robots: { index: false, follow: false },
};

export default async function EditLabGuidePage({
  params,
}: {
  params: Promise<{ guideSlug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!canManageLabGuides(session.user.siteRole)) notFound();

  const { guideSlug } = await params;
  const guide = await getLabGuideBySlug(guideSlug);
  if (!guide) notFound();

  // Reuse is invisible otherwise: a guide that opens three workshops looks
  // exactly like one that opens none, right up until it is edited or deleted.
  const usedIn = await workshopsUsingGuide(guide.id);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/labs/guides/${guide.slug}`}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        Back to the guide
      </Link>

      <h1 className="mt-6 mb-8 text-2xl font-medium tracking-tight">
        Edit lab guide
      </h1>

      <GuideEditor guide={guide} usedIn={usedIn} />
    </div>
  );
}
