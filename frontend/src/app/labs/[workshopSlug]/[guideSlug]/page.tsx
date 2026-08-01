import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getLabGuideBySlug } from "@/lib/lab-guides";
import { getWorkshopGuide } from "@/lib/lab-workshops";
import { canManageLabGuides } from "@/lib/roles";
import { GuideArticle } from "../../guide-article";

async function viewerCanEdit(): Promise<boolean> {
  const session = await auth();
  return session?.user ? canManageLabGuides(session.user.siteRole) : false;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workshopSlug: string; guideSlug: string }>;
}): Promise<Metadata> {
  const { workshopSlug, guideSlug } = await params;
  const canEdit = await viewerCanEdit();

  const [found, guide] = await Promise.all([
    getWorkshopGuide(workshopSlug, guideSlug, canEdit),
    getLabGuideBySlug(guideSlug, canEdit),
  ]);
  if (!found || !guide) return { title: "Lab guide" };

  return {
    title: `${guide.title} — ${found.workshop.title}`,
    description: guide.summary || undefined,
    ...(guide.published && found.workshop.published
      ? {}
      : { robots: { index: false, follow: false } }),
  };
}

/**
 * A lab guide read as part of a workshop.
 *
 * The guide is the same row as at `/labs/guides/<slug>`; only its surroundings
 * differ. That is the point of the split — a lab that appears in three
 * workshops is stored, edited, and rendered once, and each workshop supplies
 * its own step number, neighbours, and contents rail.
 */
export default async function WorkshopGuidePage({
  params,
}: {
  params: Promise<{ workshopSlug: string; guideSlug: string }>;
}) {
  const { workshopSlug, guideSlug } = await params;
  const canEdit = await viewerCanEdit();

  // `getWorkshopGuide` answers "is this guide in this workshop, and where?" —
  // a guide that exists but is not part of this workshop is a 404 here, so the
  // step numbering can never describe a position that doesn't exist.
  const found = await getWorkshopGuide(workshopSlug, guideSlug, canEdit);
  if (!found) notFound();

  const guide = await getLabGuideBySlug(guideSlug, canEdit);
  if (!guide) notFound();

  return (
    <GuideArticle
      guide={guide}
      canEdit={canEdit}
      context={{
        slug: found.workshop.slug,
        title: found.workshop.title,
        guides: found.workshop.guides,
        index: found.index,
        previous: found.previous,
        next: found.next,
      }}
    />
  );
}
