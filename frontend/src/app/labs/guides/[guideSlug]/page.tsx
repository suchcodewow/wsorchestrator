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
  const guide = await getLabGuideBySlug(guideSlug);
  if (!guide) return { title: "Lab guide" };

  return { title: guide.title, description: guide.summary || undefined };
}

/**
 * One lab guide, on its own — no workshop around it.
 *
 * This is the guide's canonical home: it is what the library links to, what
 * the editor returns to, and where a guide belonging to no workshop lives.
 * Readable by anyone; the session is read only to decide whether the Edit
 * button is shown.
 */
export default async function GuidePage({
  params,
}: {
  params: Promise<{ guideSlug: string }>;
}) {
  const { guideSlug } = await params;

  const guide = await getLabGuideBySlug(guideSlug);
  if (!guide) notFound();

  return <GuideArticle guide={guide} canEdit={await viewerCanEdit()} />;
}
