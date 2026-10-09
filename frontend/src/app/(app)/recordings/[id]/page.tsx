/** One recorded take: each of its files, to watch or download. */

import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getTake } from "@/lib/recording/recordings";
import { canManageTrainingSettings } from "@/lib/roles";
import { RecordingDetailView } from "./recording-detail-view";

export const dynamic = "force-dynamic";

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const [take, session] = await Promise.all([getTake((await params).id), auth()]);
  if (!take) notFound();
  return (
    <RecordingDetailView take={take} canManage={!!session?.user && canManageTrainingSettings(session.user.access)} />
  );
}
