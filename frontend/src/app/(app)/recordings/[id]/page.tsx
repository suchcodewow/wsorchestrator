/** One recorded take: each of its files, to watch or download. */

import { notFound } from "next/navigation";
import { getTake } from "@/lib/recording/recordings";
import { RecordingDetailView } from "./recording-detail-view";

export const dynamic = "force-dynamic";

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const take = await getTake((await params).id);
  if (!take) notFound();
  return <RecordingDetailView take={take} />;
}
