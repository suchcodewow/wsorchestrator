import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getLabGuideBySlug } from "@/lib/lab-guides";
import { canManageLabGuides } from "@/lib/roles";
import { GuideArticle } from "../../guide-article";

async function viewerCanEdit(): Promise<boolean> {
  const session = await auth();
  return session?.user ? canManageLabGuides(session.user.siteRole) : false;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guideSlug: string }>;
}): Promise<Metadata> {
  const { guideSlug } = await params;
  const guide = await getLabGuideBySlug(guideSlug, await viewerCanEdit());
  if (!guide) return { title: "Lab guide" };

  return {
    title: guide.title,
    description: guide.summary || undefined,
    // A draft is only reachable by a manager, but saying so out loud costs
    // nothing and keeps an unfinished lab out of a search index if the guide
    // is later unpublished while a crawler still holds the URL.
    ...(guide.published ? {} : { robots: { index: false, follow: false } }),
  };
}

/**
 * One lab guide, on its own — no workshop around it.
 *
 * This is the guide's canonical home: it is what the library links to, what
 * the editor returns to, and where a guide belonging to no workshop lives.
 */
export default async function GuidePage({
  params,
}: {
  params: Promise<{ guideSlug: string }>;
}) {
  const { guideSlug } = await params;
  const canEdit = await viewerCanEdit();

  const guide = await getLabGuideBySlug(guideSlug, canEdit);
  // An unpublished guide is a 404 for everyone who could not edit it — the
  // same answer as a slug that never existed, which is the point.
  if (!guide) notFound();

  return <GuideArticle guide={guide} canEdit={canEdit} />;
}
