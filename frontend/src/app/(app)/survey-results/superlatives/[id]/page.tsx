/** One Bootcamp's superlatives results: who the class voted for on each superlative. */

import { notFound } from "next/navigation";
import { getSuperlativeResult } from "@/lib/surveys/superlatives";
import { SuperlativeResultView } from "./superlative-result-view";

export const dynamic = "force-dynamic";

export default async function SuperlativeResultPage({ params }: { params: Promise<{ id: string }> }) {
  const survey = await getSuperlativeResult((await params).id);
  if (!survey) notFound();
  return <SuperlativeResultView survey={survey} />;
}
