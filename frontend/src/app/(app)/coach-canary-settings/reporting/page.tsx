/**
 * Coach Canary Settings → Reporting: everyone with an account, with how many
 * concept videos they have watched to the end, how many concepts the coach
 * has marked them as knowing, and where they are with each hands-on
 * experience, a page at a time. The layout lets only those who manage Coach
 * Canary in.
 */

import { EXPERIENCE_REPORT_LIST } from "@/lib/list-specs";
import { listExperienceReport } from "@/lib/mimir/experience-progress";
import { parseListQuery } from "@/lib/paging";
import { SLIDES } from "@/lib/mimir/slide-review/slides";
import { WideView } from "@/components/wide-view";
import { ReportingView } from "./reporting-view";

export default async function MimirReportingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, EXPERIENCE_REPORT_LIST);
  const page = await listExperienceReport(query);
  // A column for each experience makes the table wider than the reading column.
  return (
    <WideView>
      <ReportingView
        query={query}
        page={page}
        slides={SLIDES.map((s) => ({ id: s.id, subtitle: s.subtitle, flaws: s.flaws.length }))}
      />
    </WideView>
  );
}
