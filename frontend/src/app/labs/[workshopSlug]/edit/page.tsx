import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { listGuidesForPicker } from "@/lib/lab-guides";
import { getLabWorkshopBySlug } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";
import { WorkshopEditor } from "../../workshop-editor";

export const metadata: Metadata = {
  title: "Edit workshop",
  robots: { index: false, follow: false },
};

export default async function EditWorkshopPage({
  params,
}: {
  params: Promise<{ workshopSlug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!canManageLabGuides(session.user.siteRole)) notFound();

  const { workshopSlug } = await params;
  // Drafts included — an editor is exactly who is allowed to see one. The same
  // flag keeps draft *guides* in the contents list, which is where an author
  // needs to see them.
  const workshop = await getLabWorkshopBySlug(workshopSlug, true);
  if (!workshop) notFound();

  const guides = await listGuidesForPicker();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/labs/${workshop.slug}`}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" />
        Back to the workshop
      </Link>

      <h1 className="mt-6 mb-8 text-2xl font-medium tracking-tight">
        Edit workshop
      </h1>

      <WorkshopEditor
        workshop={workshop}
        initialGuideIds={workshop.guides.map((g) => g.id)}
        guides={guides}
      />
    </div>
  );
}
