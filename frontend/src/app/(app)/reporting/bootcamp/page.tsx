/**
 * Reporting → Live Sessions: one table of everyone with a BTC or INT record,
 * a page at a time, opening on the latest released bootcamp's graduates. An
 * Assessments Viewer sees everyone, and can switch to the class still being
 * judged; anyone else sees the people below them in HiBob, and of a bootcamp
 * only the classes an administrator has released.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { BOOTCAMP_RECORD_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import {
  bootcampRecordCounts,
  cohortCounts,
  listLiveSessions,
  liveSessionsContext,
  liveSessionsFilters,
  readerOf,
} from "@/lib/reporting/bootcamp";
import { BootcampView } from "./bootcamp-view";

export const metadata: Metadata = { title: "Live Sessions" };

export default async function BootcampPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  const { access } = session.user;
  const reader = readerOf({ access, email: session.user.email ?? null, id: session.user.id });

  const params = await searchParams;
  const query = parseListQuery(params, BOOTCAMP_RECORD_LIST);
  const context = await liveSessionsContext(reader);
  const filters = liveSessionsFilters(context, (name) => params[name]);
  const [records, counts, classCounts] = await Promise.all([
    listLiveSessions(reader, context, filters, query),
    bootcampRecordCounts(reader),
    context.class ? cohortCounts(reader, context.class.bootcamp) : null,
  ]);

  return (
    <BootcampView
      everyone={reader.all}
      graduates={context.graduates && { startDate: context.graduates.startDate, stages: context.graduates.stages }}
      inClass={
        context.class && classCounts && { startDate: context.class.bootcamp.startDate, stages: context.class.stages, counts: classCounts }
      }
      query={query}
      filters={filters}
      records={records}
      counts={counts}
    />
  );
}
