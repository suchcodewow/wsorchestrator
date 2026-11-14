/** Editing one of a presentation's own pages; for Training Administrators. */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { WideView } from "@/components/wide-view";
import { getPresentation } from "@/lib/presentations/presentations";
import { canManageTrainingSettings } from "@/lib/roles";
import { PageEditor } from "./page-editor";

export const metadata: Metadata = { title: "Edit page" };
export const dynamic = "force-dynamic";

export default async function EditPagePage({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const session = await auth();
  if (!session?.user || !canManageTrainingSettings(session.user.access)) notFound();

  const { id, pageId } = await params;
  const presentation = await getPresentation(id);
  const page = presentation?.pages.find((p) => p.id === pageId);
  if (!presentation || !page) notFound();
  return (
    <WideView>
      <PageEditor presentation={presentation} page={page} />
    </WideView>
  );
}
