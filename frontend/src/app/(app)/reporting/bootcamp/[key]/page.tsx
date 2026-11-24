/**
 * One person on Reporting → Live Sessions: their INT and BTC as a manager
 * sees them, and for Assessments every assessment behind that, which an
 * administrator can correct. 404 for someone the reader may not see.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { BOOTCAMP_RECORD_LIST, isHistoryStatus, isLiveSessionsShow, isTrackFilter } from "@/lib/list-specs";
import { listParam, parseListQuery, withParams, writeListQuery, type Page } from "@/lib/paging";
import {
  getBootcampPerson,
  listLiveSessions,
  liveSessionsContext,
  liveSessionsFilters,
  readerOf,
  type BootcampReader,
} from "@/lib/reporting/bootcamp";
import { isReleaseStage } from "@/lib/reporting/bootcamp-values";
import { canManageBootcampRecords } from "@/lib/roles";
import { PersonView } from "./person-view";

export const metadata: Metadata = { title: "Live Sessions" };

/**
 * The people either side of `key` in the table the reader opened them from, which can be on the page before or after.
 * Null for an end of the list, or when `key` is not on the page the link names.
 */
async function neighbours(
  fetchPage: (page: number) => Promise<Page<{ key: string }>>,
  page: number,
  key: string,
): Promise<{ prev: { key: string; page: number } | null; next: { key: string; page: number } | null }> {
  const here = await fetchPage(page);
  const i = here.rows.findIndex((r) => r.key === key);
  if (i < 0) return { prev: null, next: null };
  const prev =
    i > 0
      ? { key: here.rows[i - 1].key, page }
      : page > 1
        ? await fetchPage(page - 1).then((p) => (p.rows.length ? { key: p.rows[p.rows.length - 1].key, page: page - 1 } : null))
        : null;
  const next =
    i < here.rows.length - 1
      ? { key: here.rows[i + 1].key, page }
      : here.hasMore
        ? await fetchPage(page + 1).then((p) => (p.rows.length ? { key: p.rows[0].key, page: page + 1 } : null))
        : null;
  return { prev, next };
}

async function stepsFor(
  reader: BootcampReader,
  list: Record<string, string | string[] | undefined>,
  key: string,
  carried: URLSearchParams,
) {
  const query = parseListQuery(list, BOOTCAMP_RECORD_LIST);
  const context = await liveSessionsContext(reader);
  const filters = liveSessionsFilters(context, (name) => list[name]);
  const page = query.page;
  const fetchPage = (n: number) => listLiveSessions(reader, context, filters, { ...query, page: n });
  const { prev, next } = await neighbours(fetchPage, page, key);
  const hrefTo = (to: { key: string; page: number } | null) => {
    if (!to) return null;
    const p = new URLSearchParams(carried);
    p.set(listParam("page"), String(to.page));
    return `/reporting/bootcamp/${encodeURIComponent(to.key)}?${p}`;
  };
  return { prev: hrefTo(prev), next: hrefTo(next) };
}

export default async function BootcampPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  const { access } = session.user;

  const { key } = await params;
  const person = await getBootcampPerson(readerOf({ access, email: session.user.email ?? null, id: session.user.id }), key);
  if (!person) notFound();

  // The list carried its search, sorts, pages and filters here, so the back link returns to them.
  const list = await searchParams;
  const back = writeListQuery(parseListQuery(list, BOOTCAMP_RECORD_LIST), BOOTCAMP_RECORD_LIST);
  if (isLiveSessionsShow(list.show)) back.set("show", list.show);
  if (isReleaseStage(list.stage)) back.set("stage", list.stage);
  if (isHistoryStatus(list.status)) back.set("status", list.status);
  if (isTrackFilter(list.track)) back.set("track", list.track);

  const carried = new URLSearchParams();
  for (const [k, v] of Object.entries(list)) if (typeof v === "string") carried.set(k, v);
  const steps =
    list.from === "history"
      ? await stepsFor(readerOf({ access, email: session.user.email ?? null, id: session.user.id }), list, key, carried)
      : { prev: null, next: null };

  const { records } = person;
  return (
    <PersonView
      person={{
        key: person.key,
        email: person.email,
        employee: person.employee,
        classes: person.classes,
        records: records && {
          submissions: records.submissions.map((s) => ({
            ...s,
            submittedAt: s.submittedAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
          reviews: records.reviews.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
        },
        diagnostic: person.diagnostic,
        coachCanary: person.coachCanary,
      }}
      canEdit={canManageBootcampRecords(access)}
      back={withParams("/reporting/bootcamp", back)}
      steps={steps}
    />
  );
}
