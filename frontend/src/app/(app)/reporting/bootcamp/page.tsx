/**
 * Reporting → Bootcamp: the active bootcamp's cohort, then everyone with a BTC
 * or INT record, each a page at a time. Everyone signed in sees it; an
 * Assessments Viewer sees everyone, anyone else the people below them in
 * HiBob, and of the cohort only the classes an administrator has released.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { BOOTCAMP_COHORT_LIST, BOOTCAMP_COHORT_PREFIX, BOOTCAMP_RECORD_LIST, isHistoryStatus } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import {
  bootcampRecordCounts,
  cohortBootcamp,
  listBootcampRecords,
  listCohort,
  readerOf,
  visibleStages,
} from "@/lib/reporting/bootcamp";
import { canManageBootcampRecords } from "@/lib/roles";
import { BootcampView } from "./bootcamp-view";

export const metadata: Metadata = { title: "Live Sessions" };

export default async function BootcampPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  const { access } = session.user;
  const reader = readerOf({ access, email: session.user.email ?? null });

  const params = await searchParams;
  const query = parseListQuery(params, BOOTCAMP_RECORD_LIST);
  const cohortQuery = parseListQuery(params, BOOTCAMP_COHORT_LIST, BOOTCAMP_COHORT_PREFIX);
  // A hand-typed status that isn't one shows everyone, as a bad sort does.
  const status = isHistoryStatus(params.status) ? params.status : null;

  const bootcamp = await cohortBootcamp();
  const stages = bootcamp ? visibleStages(reader, bootcamp) : [];
  const [records, counts, cohort] = await Promise.all([
    listBootcampRecords(reader, query, status),
    bootcampRecordCounts(reader),
    bootcamp && stages.length > 0 ? listCohort(reader, bootcamp, cohortQuery) : null,
  ]);

  return (
    <BootcampView
      everyone={reader.all}
      canRelease={canManageBootcampRecords(access)}
      bootcamp={
        bootcamp && {
          startDate: bootcamp.startDate,
          intermediate: bootcamp.intermediate,
          released: {
            bootcamp: bootcamp.released.bootcamp && {
              at: bootcamp.released.bootcamp.at.toISOString(),
              byName: bootcamp.released.bootcamp.byName,
            },
            intermediate: bootcamp.released.intermediate && {
              at: bootcamp.released.intermediate.at.toISOString(),
              byName: bootcamp.released.intermediate.byName,
            },
          },
        }
      }
      cohort={cohort && { query: cohortQuery, page: cohort }}
      query={query}
      status={status}
      records={records}
      counts={counts}
    />
  );
}
