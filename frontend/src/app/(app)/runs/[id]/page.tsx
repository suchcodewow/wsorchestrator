/** One event's page. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { isImportedRun } from "@/lib/deployment";
import { canUseEvents } from "@/lib/roles";
import { getRunForViewer } from "@/lib/runs";
import { RunView } from "./run-view";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  const { id } = await params;
  if (!canUseEvents(session.user.access)) notFound();
  const viewer = { id: session.user.id, access: session.user.access };
  const result = await getRunForViewer(id, viewer);
  if (!result) notFound();

  return (
    <RunView
      initial={result}
      runId={id}
      viewerId={viewer.id}
      imported={isImportedRun(result.run)}
    />
  );
}
