import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getRunForUser } from "@/lib/runs";
import { RunView } from "./run-view";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const { id } = await params;
  const result = await getRunForUser(id, session!.user.id);
  if (!result) notFound();

  return <RunView initial={result} runId={id} />;
}
