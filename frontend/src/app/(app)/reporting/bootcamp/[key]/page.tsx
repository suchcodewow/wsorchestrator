/**
 * One person on Reporting → Bootcamp: their BTC and INT as a manager sees
 * them, and for Assessments every assessment behind that, which an
 * administrator can correct. 404 for someone the reader may not see.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { BOOTCAMP_COHORT_LIST, BOOTCAMP_COHORT_PREFIX, BOOTCAMP_RECORD_LIST, isHistoryStatus } from "@/lib/list-specs";
import { parseListQuery, withParams, writeListQuery } from "@/lib/paging";
import { getBootcampPerson, readerOf } from "@/lib/reporting/bootcamp";
import { canManageBootcampRecords } from "@/lib/roles";
import { PersonView } from "./person-view";

export const metadata: Metadata = { title: "Bootcamp" };

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
  const person = await getBootcampPerson(readerOf({ access, email: session.user.email ?? null }), key);
  if (!person) notFound();

  // The list carried its search, sorts, pages and status here, so the back link returns to them.
  const list = await searchParams;
  const back = writeListQuery(parseListQuery(list, BOOTCAMP_RECORD_LIST), BOOTCAMP_RECORD_LIST);
  writeListQuery(
    parseListQuery(list, BOOTCAMP_COHORT_LIST, BOOTCAMP_COHORT_PREFIX),
    BOOTCAMP_COHORT_LIST,
    back,
    BOOTCAMP_COHORT_PREFIX,
  );
  if (isHistoryStatus(list.status)) back.set("status", list.status);

  const { records } = person;
  return (
    <PersonView
      person={{
        email: person.email,
        employee: person.employee,
        classes: person.classes,
        records: records && {
          history: records.history && {
            ...records.history,
            createdAt: records.history.createdAt?.toISOString() ?? null,
            updatedAt: records.history.updatedAt?.toISOString() ?? null,
          },
          submissions: records.submissions.map((s) => ({
            ...s,
            submittedAt: s.submittedAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
        },
      }}
      canEdit={canManageBootcampRecords(access)}
      back={withParams("/reporting/bootcamp", back)}
    />
  );
}
