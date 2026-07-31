import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getRunForViewer } from "@/lib/runs";
import { RunView } from "./run-view";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const { id } = await params;
  const viewer = { id: session!.user.id, role: session!.user.siteRole };
  // Somebody else's event is a 404 for an operator and openable for a manager;
  // `getRunForViewer` is the only place that decides which.
  const result = await getRunForViewer(id, viewer);
  if (!result) notFound();

  return <RunView initial={result} runId={id} viewerId={viewer.id} />;
}
