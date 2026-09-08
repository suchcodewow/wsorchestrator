/** Writes a new guide. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { getLabWorkshopById } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";
import { GuideEditor } from "../../guide-editor";

export const metadata: Metadata = {
  title: "New lab guide",
  robots: { index: false, follow: false },
};

export default async function NewLabGuidePage({
  searchParams,
}: {
  searchParams: Promise<{ workshop?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!canManageLabGuides(session.user.siteRole)) notFound();

  const { workshop: workshopId } = await searchParams;
  const workshop = workshopId ? await getLabWorkshopById(workshopId) : null;

  const back = workshop
    ? { href: `/labs/${workshop.slug}/edit`, label: "Back to the workshop" }
    : { href: "/labs/guides", label: "All guides" };

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={back.href}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        {back.label}
      </Link>

      <h1 className="mt-6 mb-8 text-2xl font-medium tracking-tight">
        New lab guide
      </h1>

      <GuideEditor
        addTo={
          workshop
            ? { id: workshop.id, slug: workshop.slug, title: workshop.title }
            : undefined
        }
      />
    </div>
  );
}
