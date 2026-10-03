/** One stage's active assessments, a page at a time. */

import { notFound } from "next/navigation";
import { listAssessments } from "@/lib/evals/assessments";
import { isCandidateStage } from "@/lib/evals/current-cohort";
import { scoringBootcamp } from "@/lib/evals/scoring";
import { ASSESSMENT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { StageView } from "./stage-view";

export default async function EvalsStagePage({
  params,
  searchParams,
}: {
  params: Promise<{ stage: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stage } = await params;
  if (!isCandidateStage(stage)) notFound();

  const query = parseListQuery(await searchParams, ASSESSMENT_LIST);
  const [page, bootcamp] = await Promise.all([listAssessments(query, { stage, active: true }), scoringBootcamp(stage)]);
  return (
    <StageView
      stage={stage}
      query={query}
      page={{ ...page, rows: page.rows.map((a) => ({ ...a, updatedAt: a.updatedAt.toISOString() })) }}
      bootcamp={bootcamp}
    />
  );
}
