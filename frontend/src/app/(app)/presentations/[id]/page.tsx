/** One presentation: every slide of its deck, to present from, and its administration. */

import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPresentation } from "@/lib/presentations/presentations";
import { canManageTrainingSettings } from "@/lib/roles";
import { PresentationView } from "./presentation-view";

export const dynamic = "force-dynamic";

export default async function PresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const presentation = await getPresentation((await params).id);
  if (!presentation) notFound();
  return (
    <PresentationView presentation={presentation} canManage={session?.user ? canManageTrainingSettings(session.user.access) : false} />
  );
}
