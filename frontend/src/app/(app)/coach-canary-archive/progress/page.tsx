/** Your progress through Mimir: what you've told the coach about yourself, your totals, and every item. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { MIMIR_PROGRESS_LIST } from "@/lib/list-specs";
import { getProfile, listProgress, progressSummary } from "@/lib/mimir/progress";
import { parseListQuery } from "@/lib/paging";
import { ProgressView } from "./progress-view";

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const query = parseListQuery(await searchParams, MIMIR_PROGRESS_LIST);
  const [page, summary, profile] = await Promise.all([
    listProgress(session.user.id, query),
    progressSummary(session.user.id),
    getProfile(session.user.id),
  ]);
  return (
    <ProgressView
      query={query}
      summary={summary}
      profile={profile}
      page={{ ...page, rows: page.rows.map((r) => ({ ...r, lastVisitAt: r.lastVisitAt?.toISOString() ?? null })) }}
    />
  );
}
